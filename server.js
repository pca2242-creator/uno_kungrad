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
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', '+2'];

let gameStarted = false;
let currentTurnIndex = 0;
let topCard = null;
let deck = [];

// Koloda yaratish va aralashtirish
function createDeck() {
    let newDeck = [];
    COLORS.forEach(color => {
        VALUES.forEach(val => {
            newDeck.push({ color, val });
            if (val !== '0') newDeck.push({ color, val }); // 0 dan tashqari kartalardan 2 tadan
        });
    });
    return newDeck.sort(() => Math.random() - 0.5);
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
                isHost: isHost,
                hand: []
            };
            
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
            deck = createDeck();

            // Har bir o'yinchiga 7 tadan karta tarqatish
            players.forEach(p => {
                p.hand = deck.splice(0, 7);
                io.to(p.id).emit('dealHand', p.hand);
            });

            // Stol markaziga birinchi kartani qo'yish
            topCard = deck.pop();
            currentTurnIndex = 0;

            io.emit('gameStateUpdate', {
                topCard: topCard,
                currentTurnPlayer: players[currentTurnIndex].name,
                currentTurnId: players[currentTurnIndex].id
            });
        }
    });

    // Karta tashlash logikasi va tekshiruvi
    socket.on('playCard', (cardIndex) => {
        if (!gameStarted) return;
        const player = players.find(p => p.id === socket.id);

        // Faqat o'z navbati kelgan o'yinchi karta tashlay oladi
        if (player && players[currentTurnIndex].id === socket.id) {
            const playedCard = player.hand[cardIndex];

            // QOIDA TEKSHIRUVI: Rangi yoki Qiymati mos kelishi shart
            if (playedCard.color === topCard.color || playedCard.val === topCard.val) {
                topCard = playedCard;
                player.hand.splice(cardIndex, 1); // Qo'ldan olib tashlash

                // Qo'lda karta qolmagan bo'lsa - G'olib!
                if (player.hand.length === 0) {
                    io.emit('gameOver', `${player.name} g'olib bo'ldi! 🎉`);
                    gameStarted = false;
                    return;
                }

                // Navbatni keyingi o'yinchiga o'tkazish
                let step = 1;
                if (playedCard.val === 'Skip') step = 2; // Qadamni o'tkazib yuborish

                currentTurnIndex = (currentTurnIndex + step) % players.length;

                // Yangilangan holatni barchaga yuborish
                socket.emit('dealHand', player.hand);
                io.emit('gameStateUpdate', {
                    topCard: topCard,
                    currentTurnPlayer: players[currentTurnIndex].name,
                    currentTurnId: players[currentTurnIndex].id
                });
            } else {
                socket.emit('invalidMove', 'Bu kartani tashlay olmaysiz! Rangi yoki raqami mos kelishi kerak.');
            }
        }
    });

    // Kolodadan karta olish
    socket.on('drawCard', () => {
        if (!gameStarted) return;
        const player = players.find(p => p.id === socket.id);

        if (player && players[currentTurnIndex].id === socket.id) {
            if (deck.length === 0) deck = createDeck();
            const newCard = deck.pop();
            player.hand.push(newCard);

            currentTurnIndex = (currentTurnIndex + 1) % players.length;

            socket.emit('dealHand', player.hand);
            io.emit('gameStateUpdate', {
                topCard: topCard,
                currentTurnPlayer: players[currentTurnIndex].name,
                currentTurnId: players[currentTurnIndex].id
            });
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

            if (players.length < 2) gameStarted = false;
            io.emit('updatePlayers', { count: players.length, players: players });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server ${PORT}-portda ishlamoqda`);
});