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

function loadUsers() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
        return [];
    }
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        let parsedData = JSON.parse(data || '[]');
        
        // Fix for old { "users": [] } format to prevent .find() crash
        if (parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData)) {
            if (Array.isArray(parsedData.users)) {
                parsedData = parsedData.users;
            } else {
                parsedData = []; 
            }
        }
        
        return Array.isArray(parsedData) ? parsedData : [];
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

// 1. REGISTER NEW ACCOUNT
app.post('/api/register', async (req, res) => {
    const { email, username, password } = req.body;
    let users = loadUsers();
    const normalizedEmail = email.toLowerCase().trim();
    
    // Check if user already exists
    if (users.find(u => u.email === normalizedEmail || u.username === username)) {
        return res.status(400).json({ success: false, message: "Email or Username already exists." });
    }

    // Save user directly to database
    const newUser = { 
        email: normalizedEmail, 
        username: username,
        password: password, 
        senders: [] 
    };
    users.push(newUser);
    saveUsers(users);

    res.json({ success: true, message: "Account created successfully." });
});

// 2. LOGIN (Supports Email OR Username)
app.post('/api/login', (req, res) => {
    const { loginId, password } = req.body; 
    const users = loadUsers();
    const normalizedId = loginId.toLowerCase().trim();

    // Find user by email OR username
    const user = users.find(u => 
        u.email === normalizedId || 
        (u.username && u.username.toLowerCase() === normalizedId)
    );

    if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
    }
    
    if (user.password !== password) {
        return res.status(401).json({ success: false, message: "Incorrect password." });
    }

    // Login successful
    res.json({ 
        success: true, 
        user: { 
            email: user.email, 
            username: user.username, 
            senders: user.senders 
        } 
    });
});
// 2. ADD SENDER DEVICE
app.post('/api/add-sender', (req, res) => {
    const { email, senderId, name } = req.body;
    if (!email || !senderId || !name) {
        return res.status(400).json({ success: false, message: "Missing required fields." });
    }

    let users = loadUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    if (!user.senders) user.senders = [];

    let sender = user.senders.find(s => s.id === senderId);
    if (sender) {
        sender.name = name;
    } else {
        sender = { id: senderId, name: name, receivers: [] };
        user.senders.push(sender);
    }

    if (saveUsers(users)) {
        return res.json({ success: true, message: "Sender device added.", sender: sender, senders: user.senders });
    } else {
        return res.status(500).json({ success: false, message: "Failed to save sender." });
    }
});

// 3. DELETE SENDER DEVICE
app.post('/api/delete-sender', (req, res) => {
    const { email, senderId } = req.body;
    let users = loadUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    if (user.senders) {
        user.senders = user.senders.filter(s => s.id !== senderId);
    }

    if (saveUsers(users)) {
        return res.json({ success: true, message: "Sender deleted.", senders: user.senders });
    } else {
        return res.status(500).json({ success: false, message: "Failed to delete sender." });
    }
});

// 4. ADD RECEIVER TO SENDER
app.post('/api/add-receiver', (req, res) => {
    const { email, senderId, mac, name } = req.body;
    if (!email || !senderId || !mac || !name) {
        return res.status(400).json({ success: false, message: "Missing required fields." });
    }

    let users = loadUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    const sender = (user.senders || []).find(s => s.id === senderId);
    if (!sender) return res.status(404).json({ success: false, message: "Sender device not found." });

    if (!sender.receivers) sender.receivers = [];

    const cleanMac = mac.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
    const pubTopic = `esp32/${senderId}/mac_${cleanMac}/set`;
    const subTopic = `esp32/${senderId}/mac_${cleanMac}/state`;

    const newReceiver = {
        id: "rcv_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
        mac: mac,
        name: name,
        pubTopic: pubTopic,
        subTopic: subTopic
    };

    sender.receivers.push(newReceiver);

    if (saveUsers(users)) {
        return res.json({ success: true, message: "Receiver added.", receiver: newReceiver, receivers: sender.receivers });
    } else {
        return res.status(500).json({ success: false, message: "Failed to save receiver." });
    }
});

// 5. DELETE RECEIVER FROM SENDER
app.post('/api/delete-receiver', (req, res) => {
    const { email, senderId, receiverId } = req.body;
    let users = loadUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
    if (!user) return res.status(404).json({ success: false, message: "User not found." });

    const sender = (user.senders || []).find(s => s.id === senderId);
    if (!sender) return res.status(404).json({ success: false, message: "Sender not found." });

    if (sender.receivers) {
        sender.receivers = sender.receivers.filter(r => r.id !== receiverId);
    }

    if (saveUsers(users)) {
        return res.json({ success: true, message: "Receiver deleted.", receivers: sender.receivers });
    } else {
        return res.status(500).json({ success: false, message: "Failed to delete receiver." });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
