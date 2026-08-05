const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'users.json');

// Admin Key Configuration
const OWNER_SECRET_KEY = "admin123";

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Serves index.html and static files directly from root directory
app.use(express.static(__dirname));

// Direct root route to serve main frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// -------------------------------------------------------------
// HELPER FUNCTIONS FOR FILE I/O
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// API ENDPOINTS
// -------------------------------------------------------------

// 1. CLIENT LOGIN
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const users = loadUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim() && u.password === password);

    if (user) {
        return res.json({
            success: true,
            user: {
                email: user.email,
                title: user.title,
                buttons: user.buttons || []
            }
        });
    } else {
        return res.status(401).json({ success: false, message: "Invalid email or password." });
    }
});

// 2. ADMIN: AUTHENTICATE & FETCH CLIENT LIST
app.post('/api/admin/users', (req, res) => {
    const { adminKey } = req.body;

    if (adminKey !== OWNER_SECRET_KEY) {
        return res.status(403).json({ success: false, message: "Invalid owner secret key!" });
    }

    const users = loadUsers();
    const sanitizedUsers = users.map(u => ({
        email: u.email,
        title: u.title,
        buttonCount: u.buttons ? u.buttons.length : 0
    }));

    return res.json({ success: true, users: sanitizedUsers });
});

// 3. ADMIN: ADD NEW CLIENT ACCOUNT
app.post('/api/admin/add-user', (req, res) => {
    const { adminKey, email, password, title } = req.body;

    if (adminKey !== OWNER_SECRET_KEY) {
        return res.status(403).json({ success: false, message: "Unauthorized access." });
    }

    if (!email || !password || !title) {
        return res.status(400).json({ success: false, message: "All fields are required." });
    }

    const users = loadUsers();
    const normalizedEmail = email.toLowerCase().trim();

    if (users.some(u => u.email.toLowerCase() === normalizedEmail)) {
        return res.status(400).json({ success: false, message: "Client email already exists." });
    }

    const newUser = {
        email: normalizedEmail,
        password: password,
        title: title,
        buttons: []
    };

    users.push(newUser);

    if (saveUsers(users)) {
        return res.json({ success: true, message: "Client account created successfully." });
    } else {
        return res.status(500).json({ success: false, message: "Failed to save client data." });
    }
});

// 4. ADMIN: DELETE CLIENT ACCOUNT
app.post('/api/admin/delete-user', (req, res) => {
    const { adminKey, targetEmail } = req.body;

    if (adminKey !== OWNER_SECRET_KEY) {
        return res.status(403).json({ success: false, message: "Unauthorized access." });
    }

    let users = loadUsers();
    const initialCount = users.length;
    users = users.filter(u => u.email.toLowerCase() !== targetEmail.toLowerCase().trim());

    if (users.length === initialCount) {
        return res.status(404).json({ success: false, message: "Target user not found." });
    }

    if (saveUsers(users)) {
        return res.json({ success: true, message: "Client account deleted successfully." });
    } else {
        return res.status(500).json({ success: false, message: "Failed to update storage." });
    }
});

// 5. ADMIN: PAIR DEVICE BUTTON TO CLIENT
app.post('/api/admin/add-button', (req, res) => {
    const { targetEmail, buttonName, pubTopic, subTopic, macAddr } = req.body;

    if (!targetEmail || !pubTopic || !subTopic) {
        return res.status(400).json({ success: false, message: "Missing required device fields." });
    }

    let users = loadUsers();
    const userIndex = users.findIndex(u => u.email.toLowerCase() === targetEmail.toLowerCase().trim());

    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: "Client account not found." });
    }

    if (!users[userIndex].buttons) {
        users[userIndex].buttons = [];
    }

    const newButton = {
        id: "btn_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
        name: buttonName || "New Appliance",
        pubTopic: pubTopic,
        subTopic: subTopic,
        mac: macAddr || "FF:FF:FF:FF:FF:FF",
        state: false
    };

    users[userIndex].buttons.push(newButton);

    if (saveUsers(users)) {
        return res.json({ success: true, message: "Device button paired successfully.", button: newButton });
    } else {
        return res.status(500).json({ success: false, message: "Failed to save device pairing." });
    }
});

// 6. CLIENT: DELETE DEVICE BUTTON
app.post('/api/client/delete-button', (req, res) => {
    const { email, buttonId } = req.body;

    if (!email || !buttonId) {
        return res.status(400).json({ success: false, message: "Email and Button ID are required." });
    }

    let users = loadUsers();
    const userIndex = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase().trim());

    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: "Client account not found." });
    }

    if (users[userIndex].buttons) {
        const initialLength = users[userIndex].buttons.length;
        users[userIndex].buttons = users[userIndex].buttons.filter(b => b.id !== buttonId);

        if (users[userIndex].buttons.length === initialLength) {
            return res.status(404).json({ success: false, message: "Device button not found." });
        }
    }

    if (saveUsers(users)) {
        return res.json({ success: true, message: "Device deleted successfully." });
    } else {
        return res.status(500).json({ success: false, message: "Failed to delete device from storage." });
    }
});

// -------------------------------------------------------------
// START SERVER
// -------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`ESP32 Controller Server Running  `);
    console.log(`Port: ${PORT}                    `);
    console.log(`=================================`);
});
