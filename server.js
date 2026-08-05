const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const DATA_FILE = path.join(__dirname, 'users.json');

const OWNER_SECRET_KEY = "admin123";

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// SAFE USER LOADER: Always guarantees an Array return
function loadUsers() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
        return [];
    }
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8').trim();
        if (!data) return [];
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error("Error reading users.json, resetting to empty array:", err);
        return [];
    }
}

function saveUsers(users) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
        return true;
    } catch (err) {
        console.error("Error saving users.json:", err);
        return false;
    }
}

// -------------------------------------------------------------
// API ENDPOINTS
// -------------------------------------------------------------

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const users = loadUsers();

    if (!Array.isArray(users)) {
        return res.status(500).json({ success: false, message: "Database error." });
    }

    const user = users.find(u => u && u.email && u.email.toLowerCase() === (email || '').toLowerCase().trim() && u.password === password);

    if (user) {
        return res.json({
            success: true,
            user: { email: user.email, title: user.title, buttons: user.buttons || [] }
        });
    }
    return res.status(401).json({ success: false, message: "Invalid email or password." });
});

app.post('/api/admin/users', (req, res) => {
    const { adminKey } = req.body;
    if (adminKey !== OWNER_SECRET_KEY) {
        return res.status(403).json({ success: false, message: "Invalid owner secret key!" });
    }
    const users = loadUsers();
    const sanitized = users.map(u => ({
        email: u.email,
        title: u.title,
        buttonCount: Array.isArray(u.buttons) ? u.buttons.length : 0
    }));
    return res.json({ success: true, users: sanitized });
});

app.post('/api/admin/add-user', (req, res) => {
    const { adminKey, email, password, title } = req.body;
    if (adminKey !== OWNER_SECRET_KEY) return res.status(403).json({ success: false, message: "Unauthorized." });

    const users = loadUsers();
    const cleanEmail = (email || '').toLowerCase().trim();

    if (users.some(u => u.email && u.email.toLowerCase() === cleanEmail)) {
        return res.status(400).json({ success: false, message: "User already exists." });
    }

    users.push({ email: cleanEmail, password, title, buttons: [] });
    saveUsers(users);
    return res.json({ success: true, message: "User created." });
});

app.post('/api/admin/delete-user', (req, res) => {
    const { adminKey, targetEmail } = req.body;
    if (adminKey !== OWNER_SECRET_KEY) return res.status(403).json({ success: false, message: "Unauthorized." });

    let users = loadUsers();
    users = users.filter(u => u.email && u.email.toLowerCase() !== (targetEmail || '').toLowerCase().trim());
    saveUsers(users);
    return res.json({ success: true, message: "User deleted." });
});

app.post('/api/admin/add-button', (req, res) => {
    const { targetEmail, buttonName, pubTopic, subTopic, macAddr } = req.body;
    let users = loadUsers();
    const idx = users.findIndex(u => u.email && u.email.toLowerCase() === (targetEmail || '').toLowerCase().trim());

    if (idx === -1) return res.status(404).json({ success: false, message: "User not found." });

    if (!Array.isArray(users[idx].buttons)) users[idx].buttons = [];
    
    const newBtn = {
        id: "btn_" + Date.now(),
        name: buttonName || "Device",
        pubTopic,
        subTopic,
        mac: macAddr || "FF:FF:FF:FF:FF:FF",
        state: false
    };

    users[idx].buttons.push(newBtn);
    saveUsers(users);
    return res.json({ success: true, button: newBtn });
});

app.post('/api/client/delete-button', (req, res) => {
    const { email, buttonId } = req.body;
    let users = loadUsers();
    const idx = users.findIndex(u => u.email && u.email.toLowerCase() === (email || '').toLowerCase().trim());

    if (idx !== -1 && Array.isArray(users[idx].buttons)) {
        users[idx].buttons = users[idx].buttons.filter(b => b.id !== buttonId);
        saveUsers(users);
    }
    return res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
