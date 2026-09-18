const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

let players = [];
const COLORS = ['red', 'blue', 'green', 'yellow'];

io.on('connection', (socket) => {
    console.log('O\'yinchi ulandi:', socket.id);

    if (players.length < 4) {
        const playerColor = COLORS[players.length];
        players.push({ id: socket.id, color: playerColor });
        
        socket.emit('init', { id: socket.id, color: playerColor });
        io.emit('updatePlayers', players.length);
    } else {
        socket.emit('full', 'Xona to\'la! Maksimum 4 ta o\'yinchi birga o\'ynay oladi.');
    }

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        io.emit('updatePlayers', players.length);
        console.log('O\'yinchi chiqib ketdi:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server ${PORT}-portda ishlamoqda`);
});
