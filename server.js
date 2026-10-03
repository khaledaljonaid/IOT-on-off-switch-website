const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'users.json');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// Helper Functions for Data Storage
function loadUsers() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
        return [];
    }
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data || '[]');
    } catch (err) {
        console.error("Error reading users.json:", err);
        return [];
    }
}

function saveUsers(users) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
        return true;
    } catch (err) {
        console.error("Error writing users.json:", err);
        return false;
    }
}

// 1. CLIENT LOGIN / EMAIL VERIFICATION
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    if (!email) {
        return res.status(400).json({ success: false, message: "Email is required." });
    }

    const normalizedEmail = email.toLowerCase().trim();
    let users = loadUsers();
    let user = users.find(u => u.email.toLowerCase() === normalizedEmail);

    if (!user) {
        user = {
            email: normalizedEmail,
            password: password || "",
            title: normalizedEmail.split('@')[0],
            senders: []
        };
        users.push(user);
        saveUsers(users);
    } else if (password && user.password && user.password !== password) {
        return res.status(401).json({ success: false, message: "Invalid password." });
    }

    return res.json({
        success: true,
        user: {
            email: user.email,
            title: user.title,
            senders: user.senders || []
        }
    });
});

// 2. ADD SENDER (DEVICE)
app.post('/api/client/add-sender', (req, res) => {
    const { email, senderId, senderName } = req.body;
    if (!email || !senderId || !senderName) {
        return res.status(400).json({ success: false, message: "Missing required sender details." });
    }

    let users = loadUsers();
    const userIndex = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase().trim());
    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: "Client account not found." });
    }

    if (!users[userIndex].senders) users[userIndex].senders = [];

    let existingSender = users[userIndex].senders.find(s => s.id === senderId);
    if (existingSender) {
        existingSender.name = senderName;
    } else {
        existingSender = {
            id: senderId,
            name: senderName,
            pubTopic: `esp32/${senderId}/setup/config`,
            subTopic: `esp32/${senderId}/state`,
            receivers: []
        };
        users[userIndex].senders.push(existingSender);
    }

    saveUsers(users);
    return res.json({ success: true, sender: existingSender });
});

// 3. DELETE SENDER
app.post('/api/client/delete-sender', (req, res) => {
    const { email, senderId } = req.body;
    let users = loadUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    user.senders = (user.senders || []).filter(s => s.id !== senderId);
    saveUsers(users);
    return res.json({ success: true, message: "Sender deleted successfully." });
});

// 4. ADD RECEIVER TO SENDER
app.post('/api/client/add-receiver', (req, res) => {
    const { email, senderId, mac, receiverName } = req.body;
    if (!email || !senderId || !mac || !receiverName) {
        return res.status(400).json({ success: false, message: "Missing receiver details." });
    }

    let users = loadUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    const sender = (user.senders || []).find(s => s.id === senderId);
    if (!sender) return res.status(404).json({ success: false, message: "Sender device not found." });

    if (!sender.receivers) sender.receivers = [];

    const newReceiver = {
        id: "rcv_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
        name: receiverName,
        mac: mac,
        pubTopic: `esp32/${senderId}/receiver/${mac}/set`,
        subTopic: `esp32/${senderId}/receiver/${mac}/state`,
        state: false
    };

    sender.receivers.push(newReceiver);
    saveUsers(users);

    return res.json({ success: true, receiver: newReceiver });
});

// 5. DELETE RECEIVER FROM SENDER
app.post('/api/client/delete-receiver', (req, res) => {
    const { email, senderId, receiverId } = req.body;
    let users = loadUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    const sender = (user.senders || []).find(s => s.id === senderId);
    if (!sender) return res.status(404).json({ success: false, message: "Sender not found." });

    sender.receivers = (sender.receivers || []).filter(r => r.id !== receiverId);
    saveUsers(users);

    return res.json({ success: true, message: "Receiver deleted successfully." });
});

app.listen(PORT, () => {
    console.log(`ESP32 Controller Server running on http://localhost:${PORT}`);
});
