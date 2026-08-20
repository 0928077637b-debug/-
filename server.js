const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// قائمة الأماكن السرية المتاحة للعبة
const secretLocations = [
    "المستشفى 🏥",
    "المطار ✈️",
    "المدرسة 🏫",
    "المطعم 🍽️",
    "سوق العصر 🛍️",
    "السينما 🎬",
    "ملعب كرة القدم ⚽",
    "المتحف 🏛️",
    "محطة القطار 🚆"
];

let rooms = {};

io.on('connection', (socket) => {

    // 1. إنشاء غرفة جديدة
    socket.on('createRoom', (username) => {
        const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        
        rooms[roomId] = {
            host: socket.id,
            players: [{ id: socket.id, name: username }],
            gameStarted: false,
            location: '',
            imposterId: ''
        };

        socket.join(roomId);
        socket.emit('roomCreated', { roomId, players: rooms[roomId].players });
    });

    // 2. الانضمام لغرفة قائمة
    socket.on('joinRoom', ({ roomId, username }) => {
        roomId = roomId ? roomId.toUpperCase() : "";
        const room = rooms[roomId];

        if (!room) {
            return socket.emit('errorMsg', 'رمز الغرفة غير موجود!');
        }
        if (room.gameStarted) {
            return socket.emit('errorMsg', 'اللعبة بدأت بالفعل في هذه الغرفة!');
        }

        room.players.push({ id: socket.id, name: username });
        socket.join(roomId);

        socket.emit('joinedSuccessfully', { roomId, players: room.players });
        io.to(roomId).emit('updatePlayers', room.players);
    });

    // 3. بدء اللعبة وتوزيع الأدوار عشوائياً
    socket.on('startGame', (roomId) => {
        const room = rooms[roomId];
        if (!room) return;

        // اختيار مكان عشوائي واختيار "الدخيل" عشوائياً
        room.location = secretLocations[Math.floor(Math.random() * secretLocations.length)];
        const randomIndex = Math.floor(Math.random() * room.players.length);
        room.imposterId = room.players[randomIndex].id;
        room.gameStarted = true;

        // إرسال الدور المناسب لكل لاعب بشكل فردي
        room.players.forEach(player => {
            const isImposter = (player.id === room.imposterId);
            io.to(player.id).emit('gameStarted', {
                isImposter: isImposter,
                location: isImposter ? '' : room.location
            });
        });
    });

    // 4. إرسال وتلقي رسائل الشات
    socket.on('sendMessage', ({ roomId, username, message }) => {
        io.to(roomId).emit('newMessage', { username, message });
    });

    // 5. تسجيل أصوات التصويت
    socket.on('castVote', ({ roomId, target }) => {
        io.to(roomId).emit('newMessage', {
            username: "🚨 النظام",
            message: `تم تسجيل صوت ضد [ ${target} ]`
        });
    });

    // 6. التعامل مع انقطاع الاتصال
    socket.on('disconnect', () => {
        for (let roomId in rooms) {
            let room = rooms[roomId];
            const index = room.players.findIndex(p => p.id === socket.id);
            
            if (index !== -1) {
                room.players.splice(index, 1);
                
                // إذا أصبحت الغرفة فارغة يتم حذفها
                if (room.players.length === 0) {
                    delete rooms[roomId];
                } else {
                    io.to(roomId).emit('updatePlayers', room.players);
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`سيرفر لعبة الدخيل يعمل بنجاح على المنفذ ${PORT}`);
});
