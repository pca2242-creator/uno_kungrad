const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname + '/public'));
app.get('*', (req, res) => res.sendFile(__dirname + '/public/index.html'));

let players = [];
const COLORS = ['red', 'blue', 'green', 'yellow'];
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', '+2', 'Wild'];

let gameStarted = false;
let currentTurnIndex = 0;
let topCard = null;
let deck = [];
let turnTimer = null;

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

function startTurnTimer() {
    if (turnTimer) clearInterval(turnTimer);
    let timeLeft = 15;
    
    io.emit('timerUpdate', timeLeft);
    turnTimer = setInterval(() => {
        timeLeft--;
        io.emit('timerUpdate', timeLeft);
        if (timeLeft <= 0) {
            clearInterval(turnTimer);
            autoDrawAndPass();
        }
    }, 1000);
}

function autoDrawAndPass() {
    if (!gameStarted || players.length === 0) return;
    const player = players[currentTurnIndex];
    if (deck.length === 0) deck = createDeck();
    const newCard = deck.pop();
    player.hand.push(newCard);

    currentTurnIndex = (currentTurnIndex + 1) % players.length;
    io.to(player.id).emit('dealHand', player.hand);
    broadcastGameState();
}

function broadcastGameState() {
    startTurnTimer();
    io.emit('gameStateUpdate', {
        topCard,
        currentTurnPlayer: players[currentTurnIndex].name,
        currentTurnId: players[currentTurnIndex].id
    });
}

io.on('connection', (socket) => {
    socket.on('joinRoom', (playerName) => {
        if (players.length < 4 && !gameStarted) {
            const isHost = players.length === 0;
            const playerColor = COLORS[players.length];
            const newPlayer = { 
                id: socket.id, 
                name: playerName || `O'yinchi ${players.length + 1}`, 
                color: playerColor, 
                isHost,
                hand: []
            };
            
            players.push(newPlayer);
            socket.emit('init', { id: socket.id, color: playerColor, isHost });
            io.emit('updatePlayers', { count: players.length, players });
        } else {
            socket.emit('full', 'Xona to\'la!');
        }
    });

    socket.on('startGame', () => {
        const player = players.find(p => p.id === socket.id);
        if (player && player.isHost && players.length >= 2) {
            gameStarted = true;
            deck = createDeck();

            players.forEach(p => {
                p.hand = deck.splice(0, 7);
                io.to(p.id).emit('dealHand', p.hand);
            });

            do {
                topCard = deck.pop();
            } while (topCard.color === 'black');

            currentTurnIndex = 0;
            broadcastGameState();
        }
    });

    socket.on('playCard', ({ cardIndex, chosenColor }) => {
        if (!gameStarted) return;
        const player = players.find(p => p.id === socket.id);

        if (player && players[currentTurnIndex].id === socket.id) {
            const playedCard = player.hand[cardIndex];

            const isValid = playedCard.color === 'black' || 
                            playedCard.color === topCard.color || 
                            playedCard.val === topCard.val;

            if (isValid) {
                if (playedCard.color === 'black' && chosenColor) {
                    playedCard.color = chosenColor;
                }
                topCard = playedCard;
                player.hand.splice(cardIndex, 1);

                if (player.hand.length === 0) {
                    if (turnTimer) clearInterval(turnTimer);
                    io.emit('gameOver', `${player.name} g'olib bo'ldi! 🎉`);
                    gameStarted = false;
                    return;
                }

                let step = playedCard.val === 'Skip' ? 2 : 1;
                currentTurnIndex = (currentTurnIndex + step) % players.length;

                socket.emit('dealHand', player.hand);
                broadcastGameState();
            } else {
                socket.emit('invalidMove', 'Bu karta tushmaydi!');
            }
        }
    });

    socket.on('drawCard', () => {
        if (!gameStarted) return;
        if (players[currentTurnIndex].id === socket.id) {
            autoDrawAndPass();
        }
    });

    socket.on('disconnect', () => {
        const index = players.findIndex(p => p.id === socket.id);
        if (index !== -1) {
            const wasHost = players[index].isHost;
            players.splice(index, 1);
            if (wasHost && players.length > 0) {
                players[0].isHost = true;
                io.to(players[0].id).emit('makeHost');
            }
            if (players.length < 2) {
                gameStarted = false;
                if (turnTimer) clearInterval(turnTimer);
            }
            io.emit('updatePlayers', { count: players.length, players });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));