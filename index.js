var _ = require ('underscore');
var SSH2 = require ('ssh2');
var EventEmitter = require ('events').EventEmitter;

var inherits = require ('util').inherits;

module.exports = ssh2CM;
inherits (ssh2CM, EventEmitter);

var self;

function ssh2CM (options) {
	EventEmitter.call (this);
	self = this;

	var defaults = {
		'prompt': /^/,
		'more': /-{4,}\s*more\s*-{4,}/i,
		'moreSend': ' ',
		'commandEnding': '\r\n',
		'clearBuffer': false,
		'verbose': false
	};
	self.settings = _.defaults (options, defaults);
	if (! _.isRegExp (self.settings.prompt)) {
		if (_.isString (self.settings.prompt)) {
			if (self.settings.prompt.toLowerCase () == 'junos') {
				// Needs user already in config mode prompt
				self.settings.prompt = /^(?:[a-z0-9_.-]+@[a-z0-9_.-]+?[>#]|Discard\s+uncommitted\s+changes\?)\s*/;

			} else if (self.settings.prompt.toLowerCase () == 'ios') {
				self.settings.prompt = /^/;

			} else if (self.settings.prompt.toLowerCase () == 'acos') {
				self.settings.prompt = /^(?:[a-z0-9_.-]+?(?:-vmaster|-vblade)?(?:\[\d+\/\d+\])?(?:\(config(?:-[^\)]+)?\))?[>#]|are\s+you\s+sure\s+you\s+want\s+to\s+quit\s+\(n\/y\)\?:\s+)/im;

			} else if (self.settings.prompt.toLowerCase () == 'eos') {
				self.settings.prompt = /^/;

			} else {
				throw (new Error ('prompt option must be a RegExp or a pre-defined string'));
			}
		} else {
			throw (new Error ('prompt option must be a RegExp or a pre-defined string'));
		}
	}
	if (! _.isRegExp (self.settings.more)) {
		if (_.isString (self.settings.more)) {
			if (self.settings.more.toLowerCase () == 'junos') {
				self.settings.more = /^/;

			} else if (self.settings.more.toLowerCase () == 'ios') {
				self.settings.more = /^/;

			} else if (self.settings.more.toLowerCase () == 'acos') {
				self.settings.more = /^--MORE--/m;

			} else if (self.settings.more.toLowerCase () == 'eos') {
				self.settings.more = /^/;

			} else {
				throw (new Error ('more option must be a RegExp or a pre-defined string'));
			}
		} else {
			throw (new Error ('more option must be a RegExp or a pre-defined string'));
		}
	}
	if (! _.isString (self.settings.moreSend)) {
		throw (new Error ('moreSend option must be a string'));
	} else if (self.settings.moreSend.length <= 0) {
		throw (new Error ('moreSend option must be a non-zero-length string'));
	}
	if (! _.isString (self.settings.commandEnding)) {
		throw (new Error ('commandEnding option must be a string'));
	} else if (self.settings.commandEnding.length <= 0) {
		throw (new Error ('commandEnding option must be a non-zero-length string'));
	} else if (! self.settings.commandEnding.match (/^[\r\n]+$/)) {
		throw (new Error ('commandEnding option may only contain \\r and \\n'));
	}
	if (! _.isBoolean (self.settings.clearBuffer)) {
		throw (new Error ('clearBuffer option must be a boolean value'));
	}
	if (! _.isBoolean (self.settings.verbose)) {
		throw (new Error ('verbose option must be a boolean value'));
	}

	self.queue = [];
	self.stream = null;
	self.commandBuffer = '';
	self.commandRunning = true;

	self.client = new SSH2.Client ();

	self.client.on ('ready', function () {
		self.client.shell (function (err, stream) {
			if (err) {
				self.emit ('ready', err, null);

			} else {
				self.stream = stream;

				self.queue.push ({
					'command': '__MOTD__',
					'callback': function (data) {
						self.emit ('ready', null, data);
						processCommand ();
					}
				});

				self.stream.on ('data', handleData);
				self.stream.stderr.on ('data', handleData);

				self.stream.on ('close', function () {
					self.close ();
				});
			}
		});
	});

	//self.client.on ('continue', function () {
	//}

	self.client.on ('error', function (err) {
		self.emit ('error', err, null);
	});

	self.client.on ('end', function () {
		self.close ();
		self.emit ('end');
	});

	self.client.on ('close', function (hadError) {
		self.close ();
		self.emit ('close');
	});

	return (self);
}

ssh2CM.prototype.connect = function (options) {
	self.client.connect (options);

	return (self);
};

ssh2CM.prototype.run = function (command, callback) {
	if (! _.isString (command)) {
		throw (new Error ('command must be a string'));
	}
	if (! _.isFunction (callback)) {
		throw (new Error ('callback must be a function'));
	}

	self.queue.push ({
		'command': command,
		'callback': callback
	});

	processCommand ();

	return (self);
};

ssh2CM.prototype.close = function () {
	if (! _.isNull (self.stream)) {
		self.stream.end ();
		self.stream = null;
	}

	if (! _.isNull (self.client)) {
		self.client.end ();
		self.client = null;
	}

	return (self);
};

ssh2CM.prototype.flush = function () {
	self.queue = [];
	self.commandBuffer = '';

	return (self);
};

function handleData (data) {
	var entry, position, buffer;

	self.commandBuffer += data.toString ();

	if (self.commandBuffer.match (self.settings.more)) {
		self.commandBuffer = self.commandBuffer.replace (self.settings.more, '');
		self.stream.write (self.settings.moreSend);

	} else if (self.commandBuffer.match (self.settings.prompt)) {
		entry = self.queue.shift ();

		position = self.settings.prompt.exec (self.commandBuffer);
		position = position.index;

		buffer = self.commandBuffer.substr (0, position);
		self.commandBuffer = self.commandBuffer.substr (position).replace (self.settings.prompt, '');

		buffer = buffer.replace (/^.+?[\r\n]+/, '');

		self.commandRunning = false;
		entry.callback (entry.command, buffer);

		processCommand ();
	}
}

function processCommand () {
	var wait, callback, position, buffer;

	if ((self.queue.length > 0) && ! self.commandRunning) {
		self.commandRunning = true;
		if (self.settings.clearBuffer) {
			self.buffer = '';
		}
		self.stream.write (self.queue [0].command + self.settings.commandEnding);
	}
}
