const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname + '/public'));
app.get('*', (req, res) => res.sendFile(__dirname + '/public/index.html'));

let rooms = {}; // Room id orqali xonalarni boshqarish

const COLORS = ['red', 'blue', 'green', 'yellow'];
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', '+2', 'Wild'];

function createDeck() {
    let newDeck = [];
    COLORS.forEach(color => {
        VALUES.forEach(val => {
            if (val === 'Wild') {
                newDeck.push({ color: 'black', val: 'Wild' });
            } else {
                newDeck.push({ color, val });
                if (val !== '0') newDeck.push({ color, val });
            }
        });
    });
    return newDeck.sort(() => Math.random() - 0.5);
}

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ roomId, playerName }) => {
        socket.join(roomId);

        if (!rooms[roomId]) {
            rooms[roomId] = {
                players: [],
                deck: [],
                topCard: null,
                currentTurnIndex: 0,
                gameStarted: false,
                turnTimer: null
            };
        }

        const room = rooms[roomId];

        if (room.players.length < 2 && !room.gameStarted) {
            const playerColor = COLORS[room.players.length];
            const newPlayer = {
                id: socket.id,
                name: playerName || `O'yinchi ${room.players.length + 1}`,
                color: playerColor,
                isHost: room.players.length === 0,
                hand: []
            };

            room.players.push(newPlayer);
            socket.emit('init', { id: socket.id, color: playerColor, isHost: newPlayer.isHost });
            io.to(roomId).emit('updatePlayers', { count: room.players.length, players: room.players });

            // 2 ta o'yinchi yig'ilsa o'yin avtomatik boshlanadi
            if (room.players.length === 2) {
                startGame(roomId);
            }
        } else {
            socket.emit('full', 'Xona to\'la!');
        }
    });

    function startGame(roomId) {
        const room = rooms[roomId];
        if (!room) return;

        room.gameStarted = true;
        room.deck = createDeck();

        room.players.forEach(p => {
            p.hand = room.deck.splice(0, 7);
            io.to(p.id).emit('dealHand', p.hand);
        });

        do {
            room.topCard = room.deck.pop();
        } while (room.topCard.color === 'black');

        room.currentTurnIndex = 0;
        broadcastGameState(roomId);
    }

    function broadcastGameState(roomId) {
        const room = rooms[roomId];
        if (!room) return;

        startTurnTimer(roomId);
        io.to(roomId).emit('gameStateUpdate', {
            topCard: room.topCard,
            currentTurnPlayer: room.players[room.currentTurnIndex].name,
            currentTurnId: room.players[room.currentTurnIndex].id
        });
    }

    function startTurnTimer(roomId) {
        const room = rooms[roomId];
        if (!room) return;

        if (room.turnTimer) clearInterval(room.turnTimer);
        let timeLeft = 15;

        io.to(roomId).emit('timerUpdate', timeLeft);
        room.turnTimer = setInterval(() => {
            timeLeft--;
            io.to(roomId).emit('timerUpdate', timeLeft);
            if (timeLeft <= 0) {
                clearInterval(room.turnTimer);
                autoDrawAndPass(roomId);
            }
        }, 1000);
    }

    function autoDrawAndPass(roomId) {
        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;

        const player = room.players[room.currentTurnIndex];
        if (room.deck.length === 0) room.deck = createDeck();
        const newCard = room.deck.pop();
        player.hand.push(newCard);

        room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
        io.to(player.id).emit('dealHand', player.hand);
        broadcastGameState(roomId);
    }

    socket.on('playCard', ({ roomId, cardIndex, chosenColor }) => {
        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;

        const player = room.players.find(p => p.id === socket.id);
        if (player && room.players[room.currentTurnIndex].id === socket.id) {
            const playedCard = player.hand[cardIndex];
            const isValid = playedCard.color === 'black' || 
                            playedCard.color === room.topCard.color || 
                            playedCard.val === room.topCard.val;

            if (isValid) {
                if (playedCard.color === 'black' && chosenColor) {
                    playedCard.color = chosenColor;
                }
                room.topCard = playedCard;
                player.hand.splice(cardIndex, 1);

                if (player.hand.length === 0) {
                    if (room.turnTimer) clearInterval(room.turnTimer);
                    io.to(roomId).emit('gameOver', `${player.name} g'olib bo'ldi! 🎉`);
                    delete rooms[roomId];
                    return;
                }

                let step = playedCard.val === 'Skip' ? 2 : 1;
                room.currentTurnIndex = (room.currentTurnIndex + step) % room.players.length;

                socket.emit('dealHand', player.hand);
                broadcastGameState(roomId);
            } else {
                socket.emit('invalidMove', 'Bu karta tushmaydi!');
            }
        }
    });

    socket.on('drawCard', ({ roomId }) => {
        const room = rooms[roomId];
        if (room && room.players[room.currentTurnIndex].id === socket.id) {
            autoDrawAndPass(roomId);
        }
    });

    socket.on('disconnect', () => {
        for (let roomId in rooms) {
            let room = rooms[roomId];
            let index = room.players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                room.players.splice(index, 1);
                if (room.turnTimer) clearInterval(room.turnTimer);
                io.to(roomId).emit('gameOver', 'Raqib o\'yindan chiqib ketdi!');
                delete rooms[roomId];
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));