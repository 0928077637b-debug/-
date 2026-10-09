const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.get('/', (req, res) => res.send('سيرفر لعبة الدخيل يعمل'));

const MIN_PLAYERS = 3;   // أقل عدد لبدء اللعبة
const MAX_PLAYERS = 12;  // أقصى عدد في الغرفة

// قائمة الكلمات السرية (أماكن + مهن + أشياء + حيوانات + أكلات) تُختار منها عشوائياً
const secretLocations = [
    // أماكن
    "المستشفى 🏥",
    "المطار ✈️",
    "المدرسة 🏫",
    "المطعم 🍽️",
    "سوق العصر 🛍️",
    "السينما 🎬",
    "ملعب كرة القدم ⚽",
    "المتحف 🏛️",
    "محطة القطار 🚆",
    "الجامعة 🎓",
    "المسجد 🕌",
    "الشاطئ 🏖️",
    "الحديقة العامة 🌳",
    "محطة البنزين ⛽",
    "البنك 🏦",
    "المكتبة 📚",
    "الصيدلية 💊",
    "الفندق 🏨",
    "السجن 🔒",
    "مركز الشرطة 🚓",
    "المخبز 🥖",
    "صالة الأفراح 💍",
    "الملاهي 🎢",
    "السفينة 🚢",
    "الصحراء 🏜️",
    "المزرعة 🚜",
    "الجبل ⛰️",
    "النيل 🌊",
    // مهن
    "الطبيب 👨‍⚕️",
    "المعلم 👩‍🏫",
    "الطيار 👨‍✈️",
    "الشرطي 👮",
    "الطباخ 👨‍🍳",
    "الحلاق ✂️",
    "المهندس 👷",
    "رجل الإطفاء 🚒",
    "السائق 🚕",
    "المزارع 👨‍🌾",
    "الصحفي 📰",
    "القاضي ⚖️",
    // أشياء
    "الهاتف 📱",
    "السيارة 🚗",
    "الثلاجة 🧊",
    "الكاميرا 📷",
    "الساعة ⏰",
    "المظلة ☂️",
    "المفتاح 🔑",
    "الكرسي 🪑",
    "المرآة 🪞",
    "الدراجة 🚲",
    "الشاحن 🔌",
    // حيوانات
    "الأسد 🦁",
    "الجمل 🐪",
    "القطة 🐱",
    "التمساح 🐊",
    "الفيل 🐘",
    "الحصان 🐴",
    // أكلات ومشروبات
    "البيتزا 🍕",
    "الشاي ☕",
    "الآيس كريم 🍦",
    "البطيخ 🍉",
    "الفول 🫘",
    "الكبسة 🍛"
];

let rooms = {};

// ---------- دوال مساعدة ----------

function cleanName(name) {
    const n = String(name || '').trim().slice(0, 20);
    return n || 'لاعب';
}

function uniqueName(room, name) {
    let finalName = name;
    let i = 2;
    while (room.players.some(p => p.name === finalName)) {
        finalName = `${name} (${i++})`;
    }
    return finalName;
}

function publicRooms() {
    return Object.entries(rooms)
        .filter(([, r]) => !r.gameStarted)
        .map(([roomId, r]) => ({ roomId, count: r.players.length }));
}

function broadcastRooms() {
    io.emit('updateRoomsList', publicRooms());
}

function roomState(room) {
    return { players: room.players, hostId: room.host };
}

function resetRoom(room) {
    room.gameStarted = false;
    room.location = '';
    room.imposterId = '';
    room.imposterName = '';
    room.votes = {};
}

function finishGame(roomId, room, result) {
    io.to(roomId).emit('gameOver', {
        playersWon: result.playersWon,
        reason: result.reason,
        imposterName: room.imposterName,
        location: room.location,
        votedName: result.votedName || ''
    });
    resetRoom(room);
    io.to(roomId).emit('updatePlayers', roomState(room));
    broadcastRooms();
}

// عدّ الأصوات، وإذا صوّت الجميع تنتهي الجولة
function checkVotes(roomId, room) {
    const total = room.players.length;
    const voted = Object.keys(room.votes).length;
    io.to(roomId).emit('voteUpdate', { voted, total });
    if (voted < total) return;

    const counts = {};
    Object.values(room.votes).forEach(t => { counts[t] = (counts[t] || 0) + 1; });

    let max = 0;
    let top = [];
    for (const [id, c] of Object.entries(counts)) {
        if (c > max) { max = c; top = [id]; }
        else if (c === max) top.push(id);
    }

    if (top.length !== 1) {
        return finishGame(roomId, room, { playersWon: false, reason: 'tie' });
    }

    const votedPlayer = room.players.find(p => p.id === top[0]);
    const caught = top[0] === room.imposterId;
    finishGame(roomId, room, {
        playersWon: caught,
        reason: caught ? 'caught' : 'wrongVote',
        votedName: votedPlayer ? votedPlayer.name : ''
    });
}

function removePlayer(socket) {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.leave(roomId);
    socket.data.roomId = null;

    const room = rooms[roomId];
    if (!room) return;

    const index = room.players.findIndex(p => p.id === socket.id);
    if (index === -1) return;
    room.players.splice(index, 1);

    // إذا أصبحت الغرفة فارغة تُحذف
    if (room.players.length === 0) {
        delete rooms[roomId];
        broadcastRooms();
        return;
    }

    // إذا خرج المضيف ينتقل الدور للاعب التالي
    if (room.host === socket.id) {
        room.host = room.players[0].id;
    }

    if (room.gameStarted) {
        delete room.votes[socket.id];
        for (const voter in room.votes) {
            if (room.votes[voter] === socket.id) delete room.votes[voter];
        }

        if (socket.id === room.imposterId) {
            return finishGame(roomId, room, { playersWon: true, reason: 'imposterLeft' });
        }
        if (room.players.length < 2) {
            resetRoom(room);
            io.to(roomId).emit('gameAborted', 'لاعبون كثيرون غادروا، أُلغيت الجولة.');
        } else {
            checkVotes(roomId, room);
        }
    }

    io.to(roomId).emit('updatePlayers', roomState(room));
    broadcastRooms();
}

// ---------- الأحداث ----------

io.on('connection', (socket) => {
    socket.data.roomId = null;
    socket.emit('updateRoomsList', publicRooms());

    // 1. إنشاء غرفة جديدة
    socket.on('createRoom', (username) => {
        removePlayer(socket);

        let roomId;
        do {
            roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
        } while (rooms[roomId]);

        rooms[roomId] = {
            host: socket.id,
            players: [{ id: socket.id, name: cleanName(username) }],
            gameStarted: false,
            location: '',
            imposterId: '',
            imposterName: '',
            votes: {}
        };

        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.emit('roomCreated', { roomId, ...roomState(rooms[roomId]) });
        broadcastRooms();
    });

    // 2. الانضمام لغرفة قائمة
    socket.on('joinRoom', ({ roomId, username } = {}) => {
        roomId = roomId ? String(roomId).toUpperCase() : '';
        const room = rooms[roomId];

        if (!room) {
            return socket.emit('errorMsg', 'رمز الغرفة غير موجود!');
        }
        if (room.gameStarted) {
            return socket.emit('errorMsg', 'اللعبة بدأت بالفعل في هذه الغرفة!');
        }
        if (room.players.length >= MAX_PLAYERS) {
            return socket.emit('errorMsg', 'الغرفة ممتلئة!');
        }

        removePlayer(socket);

        room.players.push({ id: socket.id, name: uniqueName(room, cleanName(username)) });
        socket.join(roomId);
        socket.data.roomId = roomId;

        socket.emit('joinedSuccessfully', { roomId, ...roomState(room) });
        io.to(roomId).emit('updatePlayers', roomState(room));
        broadcastRooms();
    });

    // 3. مغادرة الغرفة
    socket.on('leaveRoom', () => removePlayer(socket));

    // 4. بدء اللعبة (للمضيف فقط)
    socket.on('startGame', () => {
        const roomId = socket.data.roomId;
        const room = rooms[roomId];
        if (!room) return;

        if (room.host !== socket.id) {
            return socket.emit('errorMsg', 'فقط مضيف الغرفة يستطيع بدء اللعبة!');
        }
        if (room.gameStarted) return;
        if (room.players.length < MIN_PLAYERS) {
            return socket.emit('errorMsg', `تحتاج ${MIN_PLAYERS} لاعبين على الأقل لبدء اللعبة!`);
        }

        // اختيار كلمة عشوائية مختلفة عن كلمة الجولة السابقة
        let pick;
        do {
            pick = secretLocations[Math.floor(Math.random() * secretLocations.length)];
        } while (pick === room.lastLocation && secretLocations.length > 1);
        room.lastLocation = pick;
        room.location = pick;
        const imposter = room.players[Math.floor(Math.random() * room.players.length)];
        room.imposterId = imposter.id;
        room.imposterName = imposter.name;
        room.votes = {};
        room.gameStarted = true;

        room.players.forEach(player => {
            const isImposter = (player.id === room.imposterId);
            io.to(player.id).emit('gameStarted', {
                isImposter,
                location: isImposter ? '' : room.location,
                players: room.players
            });
        });
        broadcastRooms();
    });

    // 5. الشات (الاسم يؤخذ من السيرفر وليس من العميل)
    socket.on('sendMessage', ({ message } = {}) => {
        const roomId = socket.data.roomId;
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const text = String(message || '').trim().slice(0, 200);
        if (!text) return;
        io.to(roomId).emit('newMessage', { username: player.name, message: text });
    });

    // 6. التصويت (يمكن تغيير الصوت حتى يصوّت الجميع)
    socket.on('castVote', ({ target } = {}) => {
        const roomId = socket.data.roomId;
        const room = rooms[roomId];
        if (!room || !room.gameStarted) return;
        if (target === socket.id) return;
        if (!room.players.some(p => p.id === target)) return;

        room.votes[socket.id] = target;
        checkVotes(roomId, room);
    });

    // 7. انقطاع الاتصال
    socket.on('disconnect', () => removePlayer(socket));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`سيرفر لعبة الدخيل يعمل بنجاح على المنفذ ${PORT}`);
});
