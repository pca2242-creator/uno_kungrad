const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

const COLORS = ['Red', 'Blue', 'Green', 'Yellow'];
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', 'Reverse', '+2'];

function createDeck() {
    let deck = [];
    for (let color of COLORS) {
        for (let value of VALUES) {
            deck.push({ color, value });
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

let room = {
    players: [],
    deck: [],
    discardPile: [],
    currentTurn: 0,
    started: false
};

io.on('connection', (socket) => {
    socket.on('joinRoom', (username) => {
        if (room.players.length >= 4 || room.started) {
            socket.emit('errorMsg', 'Xona to\'la yoki o\'yin boshlanib bo\'lgan!');
            return;
        }

        const player = { id: socket.id, username, cards: [] };
        room.players.push(player);
        socket.join('uno_room');

        io.to('uno_room').emit('roomUpdate', {
            players: room.players.map(p => p.username),
            count: room.players.length
        });

        if (room.players.length === 4) {
            startGame();
        }
    });

    socket.on('playCard', (cardIndex) => {
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== room.currentTurn) return;

        const player = room.players[playerIndex];
        const card = player.cards[cardIndex];
        const topCard = room.discardPile[room.discardPile.length - 1];

        // Karta tushish qoidasi (Rangi yoki qiymati mos kelishi kerak)
        if (card.color === topCard.color || card.value === topCard.value) {
            player.cards.splice(cardIndex, 1);
            room.discardPile.push(card);

            if (player.cards.length === 0) {
                io.to('uno_room').emit('gameOver', { winner: player.username });
                resetGame();
                return;
            }

            // Keyingi o'yinchi navbati
            room.currentTurn = (room.currentTurn + 1) % 4;
            sendGameState();
        }
    });

    socket.on('drawCard', () => {
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== room.currentTurn) return;

        if (room.deck.length === 0) room.deck = createDeck();
        room.players[playerIndex].cards.push(room.deck.pop());
        
        room.currentTurn = (room.currentTurn + 1) % 4;
        sendGameState();
    });

    socket.on('disconnect', () => {
        room.players = room.players.filter(p => p.id !== socket.id);
        if (room.players.length < 4 && room.started) {
            resetGame();
            io.to('uno_room').emit('errorMsg', 'O\'yinchi chiqib ketdi. O\'yin to\'xtatildi.');
        }
    });
});

function startGame() {
    room.started = true;
    room.deck = createDeck();
    room.discardPile = [room.deck.pop()];

    // Har bir o'yinchiga 7 tadan karta tarqatish
    room.players.forEach(player => {
        player.cards = room.deck.splice(0, 7);
    });

    sendGameState();
}

function sendGameState() {
    room.players.forEach((player) => {
        io.to(player.id).emit('gameState', {
            myCards: player.cards,
            topCard: room.discardPile[room.discardPile.length - 1],
            currentTurnUser: room.players[room.currentTurn].username,
            players: room.players.map(p => ({ username: p.username, cardCount: p.cards.length }))
        });
    });
}

function resetGame() {
    room = { players: [], deck: [], discardPile: [], currentTurn: 0, started: false };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
