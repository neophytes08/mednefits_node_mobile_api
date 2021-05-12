/**
 * Socket.io configuration
 */

'use strict';

// var config = require('./environment');

// When the user disconnects.. perform this
// function onDisconnect (socket) {
// }

// // When the user connects.. perform this
// function onConnect (socket) {

// 	// When the client emits 'ping', this listens and executes
// 	socket.on('ping', function (data) {
// 		console.info('ping [%s] %s', socket.address, JSON.stringify(data, null, 2));
// 		socket.emit('pong', 'This is coming from the Socket.io Server - ' + new Date());
// 	});

// 	// Insert sockets below
// 	// require('../api/thing/thing.socket').register(socket);
// }

// module.exports = function (socketio) {
// 	// socket.io (v1.x.x) is powered by debug.
// 	// In order to see all the debug output, set DEBUG (in server/config/local.env.js) to including the desired scope.
// 	//
// 	// ex: DEBUG: "http*,socket.io:socket"

// 	// We can authenticate socket.io users and access their token through socket.handshake.decoded_token
// 	//
// 	// 1. You will need to send the token in `client/components/socket/socket.service.js`
// 	//
// 	// 2. Require authentication here:
// 	// socketio.use(require('socketio-jwt').authorize({
// 	//   secret: config.secrets.session,
// 	//   handshake: true
// 	// }));


// 	// Set allowed origins
// 	//socketio.set('origins', 'http://localhost:9007');

// 	// Set allowed polling mechanisms
// 	//socketio.set('transports', ['xhr-polling']);

// 	socketio.on('connection', function (socket) {
// 		socket.address = socket.handshake.address !== null ?
// 			socket.handshake.address.address + ':' + socket.handshake.address.port :
// 			process.env.DOMAIN;

// 		socket.connectedAt = new Date();

// 		// Call onDisconnect.
// 		socket.on('disconnect', function () {
// 			onDisconnect(socket);
// 			console.info('[%s] DISCONNECTED', socket.address);
// 		});

// 		// Call onConnect.
// 		onConnect(socket);
// 		console.info('[%s] CONNECTED', socket.address);
// 	});
// };

// export default a(io);
// module.exports = function a(io){
const users = [];

const addUser = ({ id, name, room }) => {
  name = name.trim().toLowerCase();
  room = room.trim().toLowerCase();

  const existingUser = users.find((user) => user.room === room && user.name === name);

  if(!name || !room) return { error: 'Username and room are required.' };
  if(existingUser) return { error: 'Username is taken.' };

  const user = { id, name, room };

  users.push(user);

  return { user };
}

const removeUser = (id) => {
  const index = users.findIndex((user) => user.id === id);

  if(index !== -1) return users.splice(index, 1)[0];
}

const getUser = (id) => users.find((user) => user.id === id);

const getUsersInRoom = (room) => users.filter((user) => user.room === room);

module.exports = function a(io){
	io.on('connection', function(socket){
		socket.on('chat message', function(msg){
			const user = getUser(socket.id);
			io.to(user.room).emit('chat message', `${user.name}: ${msg}`);
		});

		socket.on('join', ({ name, room }, callback) => {
			const { error, user } = addUser({ id: socket.id, name, room });

			if(error) return callback(error);

			socket.join(user.room);

			socket.emit('message', { user: 'admin', text: `${user.name}, welcome to room ${user.room}.`});
			socket.broadcast.to(user.room).emit('message', { user: 'admin', text: `${user.name} has joined!` });

			io.to(user.room).emit('roomData', { room: user.room, users: getUsersInRoom(user.room) });

			callback();

			// const { error, user } = addUser({ id: socket.id, name, room });

			// if(error) return callback(error);

			// socket.join(room);

			// socket.emit('message', { user: 'admin', text: `${name}, welcome to room ${room}.`});
			// socket.broadcast.to(room).emit('message', { user: 'admin', text: `${name} has joined!` });

			// // io.to(user.room).emit('roomData', { room: user.room, users: getUsersInRoom(user.room) });

			// callback();
		});

		socket.on('sendMessage', (message, callback) => {
			const user = getUser(socket.id);

			io.to(user.room).emit('message', { user: user.name, text: message });

			callback();
		});

		socket.on('disconnect', () => {
			const user = removeUser(socket.id);

			if(user) {
				io.to(user.room).emit('message', { user: 'Admin', text: `${user.name} has left.` });
				io.to(user.room).emit('roomData', { room: user.room, users: getUsersInRoom(user.room)});
			}
		});

		/**
		 * EmpatKali assets here
		 */
		socket.on('appNotif', (data) => {

		});

		socket.on('transactionNotif', (data) => {

		});

		socket.on('paymentNotif', (data) => {

		});

		socket.on('statusChanged', (data) => {

		});

		socket.on('finishTransaction', (data) => {
			console.log(`TAAAAII: ${JSON.stringify(data)}`);
			io.to(data.mn).emit('finishTransaction', data.detail);
		});
	});
}; 