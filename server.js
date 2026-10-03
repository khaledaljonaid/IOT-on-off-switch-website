const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Initialize DB if missing
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [] }, null, 2));
}

const readDB = () => JSON.parse(fs.readFileSync(DB_FILE));
const writeDB = (data) => fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));

// Client Email Sign In / Verification
app.post('/api/login', (req, res) => {
    const { email } = req.body;
    const db = readDB();
    let user = db.users.find(u => u.email === email);
    
    // Auto-register new emails for simplicity in this workflow
    if (!user) {
        user = { email, senders: [] };
        db.users.push(user);
        writeDB(db);
    }
    res.json({ success: true, user });
});

// Add Sender (Device)
app.post('/api/add-sender', (req, res) => {
    const { email, id, name, subTopic } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.email === email);
    
    if (!user) return res.json({ success: false, message: 'User not found' });
    
    const newSender = { id, name, subTopic, receivers: [] };
    user.senders.push(newSender);
    writeDB(db);
    
    res.json({ success: true, sender: newSender });
});

// Add Receiver
app.post('/api/add-receiver', (req, res) => {
    const { email, senderId, mac, name } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.email === email);
    if (!user) return res.json({ success: false });

    const sender = user.senders.find(s => s.id === senderId);
    if (!sender) return res.json({ success: false });

    const newReceiver = { mac, name };
    sender.receivers.push(newReceiver);
    writeDB(db);
    
    res.json({ success: true, receiver: newReceiver });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
