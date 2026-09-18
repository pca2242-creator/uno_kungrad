const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(__dirname + '/public'));

app.get('*', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

let players = [];
const COLORS = ['red', 'blue', 'green', 'yellow'];
let gameStarted = false;

io.on('connection', (socket) => {
    console.log('O\'yinchi ulandi:', socket.id);

    socket.on('joinRoom', (playerName) => {
        if (players.length < 4 && !gameStarted) {
            const isHost = players.length === 0; // Birinchi kirgan kishi Host bo'ladi
            const playerColor = COLORS[players.length];
            const newPlayer = { id: socket.id, name: playerName || `O'yinchi ${players.length + 1}`, color: playerColor, isHost: isHost };
            
            players.push(newPlayer);
            
            socket.emit('init', { id: socket.id, color: playerColor, isHost: isHost });
            io.emit('updatePlayers', { count: players.length, players: players });
        } else {
            socket.emit('full', 'Xona to\'la yoki o\'yin boshlanib bo\'lingan!');
        }
    });

    socket.on('startGame', () => {
        const player = players.find(p => p.id === socket.id);
        if (player && player.isHost && players.length >= 2) {
            gameStarted = true;
            io.emit('gameStarted', {
                message: `O'yin boshlandi! Jami o'yinchilar: ${players.length} kishi.`,
                players: players
            });
        }
    });

    socket.on('disconnect', () => {
        const index = players.findIndex(p => p.id === socket.id);
        if (index !== -1) {
            const wasHost = players[index].isHost;
            players.splice(index, 1);
            
            // Agar Host chiqib ketgan bo'lsa, keyingi o'yinchiga Host beriladi
            if (wasHost && players.length > 0) {
                players[0].isHost = true;
                io.to(players[0].id).emit('makeHost');
            }

            if (players.length < 2) {
                gameStarted = false;
            }

            io.emit('updatePlayers', { count: players.length, players: players });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server ${PORT}-portda ishlamoqda`);
});