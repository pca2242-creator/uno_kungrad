const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname + '/public'));
app.get('*', (req, res) => res.sendFile(__dirname + '/public/index.html'));

let rooms = {};
let publicQueueRoom = null; // Public matchmaking xonasi

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
    socket.on('joinRoom', ({ roomId, playerName, isPublic }) => {
        let targetRoomId = roomId;

        if (isPublic) {
            if (!publicQueueRoom || (rooms[publicQueueRoom] && rooms[publicQueueRoom].players.length >= 2)) {
                publicQueueRoom = 'pub_' + Math.random().toString(36).substr(2, 6);
            }
            targetRoomId = publicQueueRoom;
        }

        socket.join(targetRoomId);

        if (!rooms[targetRoomId]) {
            rooms[targetRoomId] = {
                players: [],
                deck: [],
                topCard: null,
                currentTurnIndex: 0,
                gameStarted: false,
                turnTimer: null
            };
        }

        const room = rooms[targetRoomId];

        if (room.players.length < 2 && !room.gameStarted) {
            const isHost = room.players.length === 0;
            const playerColor = COLORS[room.players.length];
            const newPlayer = {
                id: socket.id,
                name: playerName || `O'yinchi ${room.players.length + 1}`,
                color: playerColor,
                isHost,
                hand: []
            };

            room.players.push(newPlayer);
            socket.emit('init', { id: socket.id, roomId: targetRoomId, color: playerColor, isHost });
            io.to(targetRoomId).emit('updatePlayers', { count: room.players.length, players: room.players, hostId: room.players[0].id });
        } else {
            socket.emit('full', 'Xona to\'la!');
        }
    });

    socket.on('startGame', ({ roomId }) => {
        const room = rooms[roomId];
        if (room && room.players.length >= 2 && room.players[0].id === socket.id && !room.gameStarted) {
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
    });

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
        for (let rId in rooms) {
            let room = rooms[rId];
            let index = room.players.findIndex(p => p.id === socket.id);
            if (index !== -1) {
                room.players.splice(index, 1);
                if (room.turnTimer) clearInterval(room.turnTimer);
                io.to(rId).emit('gameOver', 'Raqib o\'yindan chiqib ketdi!');
                delete rooms[rId];
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));