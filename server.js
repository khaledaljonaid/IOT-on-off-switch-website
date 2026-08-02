// node server.js
// server.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());

// Serve static web files (index.html, css, js) from current directory
app.use(express.static(__dirname));

const DB_FILE = 'users.json';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'khaled_123_123';

// Helper: Read users from JSON file
function getUsers() {
    if (!fs.existsSync(DB_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(DB_FILE));
    } catch (err) {
        return {};
    }
}

// Helper: Save users to JSON file
function saveUsers(users) {
    fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
}

// ------------------------------------
// 1. CLIENT LOGIN ENDPOINT
// ------------------------------------
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const users = getUsers();

    if (users[email] && users[email].password === password) {
        const { password: _, ...userData } = users[email];
        userData.email = email; 
        // Ensure buttons array exists
        userData.buttons = userData.buttons || [];
        res.json({ success: true, user: userData });
    } else {
        res.status(401).json({ success: false, message: 'Invalid email or password!' });
    }
});

// ------------------------------------
// 2. ADMIN: GET ALL USERS
// ------------------------------------
app.post('/api/admin/users', (req, res) => {
    const { adminKey } = req.body;
    if (adminKey !== ADMIN_SECRET) {
        return res.status(403).json({ success: false, message: 'Unauthorized: Invalid Admin Key!' });
    }

    const users = getUsers();
    const safeUsers = Object.keys(users).map(email => ({
        email: email,
        title: users[email].title,
        buttons: users[email].buttons || []
    }));

    res.json({ success: true, users: safeUsers });
});

// ------------------------------------
// 3. ADMIN: ADD NEW CLIENT USER
// ------------------------------------
app.post('/api/admin/add-user', (req, res) => {
    const { adminKey, email, password, title } = req.body;
    
    if (adminKey !== ADMIN_SECRET) {
        return res.status(403).json({ success: false, message: 'Unauthorized: Invalid Admin Key!' });
    }

    const users = getUsers();
    if (users[email]) {
        return res.status(400).json({ success: false, message: 'User/Email already exists!' });
    }

    // Initialize with empty array of custom buttons/switches
    users[email] = { 
        password, 
        title: title || 'Client Dashboard', 
        buttons: [] 
    };
    saveUsers(users);

    res.json({ success: true, message: 'Client account created successfully!' });
});

// ------------------------------------
// 4. ADMIN: ADD BUTTON TO CLIENT DASHBOARD
// ------------------------------------
app.post('/api/admin/add-button', (req, res) => {
    const { adminKey, targetEmail, buttonName, pubTopic, subTopic } = req.body;

    if (adminKey !== ADMIN_SECRET) {
        return res.status(403).json({ success: false, message: 'Unauthorized: Invalid Admin Key!' });
    }

    const users = getUsers();
    if (!users[targetEmail]) {
        return res.status(404).json({ success: false, message: 'Client not found!' });
    }

    if (!users[targetEmail].buttons) {
        users[targetEmail].buttons = [];
    }

    const newButton = {
        id: 'btn_' + Date.now(),
        name: buttonName || 'Switch Control',
        pubTopic: pubTopic,
        subTopic: subTopic
    };

    users[targetEmail].buttons.push(newButton);
    saveUsers(users);

    res.json({ success: true, message: 'Button added successfully!', button: newButton });
});

// ------------------------------------
// 5. ADMIN: DELETE BUTTON FROM CLIENT DASHBOARD
// ------------------------------------
app.post('/api/admin/delete-button', (req, res) => {
    const { adminKey, targetEmail, buttonId } = req.body;

    if (adminKey !== ADMIN_SECRET) {
        return res.status(403).json({ success: false, message: 'Unauthorized: Invalid Admin Key!' });
    }

    const users = getUsers();
    if (!users[targetEmail] || !users[targetEmail].buttons) {
        return res.status(404).json({ success: false, message: 'Client or buttons not found!' });
    }

    // Filter out the button with matching buttonId
    users[targetEmail].buttons = users[targetEmail].buttons.filter(btn => btn.id !== buttonId);
    saveUsers(users);

    res.json({ success: true, message: 'Button deleted successfully!' });
});

// ------------------------------------
// 6. ADMIN: DELETE CLIENT USER
// ------------------------------------
app.post('/api/admin/delete-user', (req, res) => {
    const { adminKey, email } = req.body;

    if (adminKey !== ADMIN_SECRET) {
        return res.status(403).json({ success: false, message: 'Unauthorized: Invalid Admin Key!' });
    }

    const users = getUsers();
    if (!users[email]) {
        return res.status(404).json({ success: false, message: 'User not found!' });
    }

    delete users[email];
    saveUsers(users);

    res.json({ success: true, message: 'Client account deleted successfully!' });
});

// Root Route - Serves main page cleanly
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
