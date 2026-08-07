const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Explicit path to users.json in the same root folder as server.js
const DATA_FILE = path.join(__dirname, 'users.json');

// Configuration
const OWNER_SECRET_KEY = "admin123";

// Middleware setup with full CORS support
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json());

// Serve static frontend files (index.html, style.css, etc.) from current directory
app.use(express.static(__dirname));

// -------------------------------------------------------------
// SAFE HELPER FUNCTIONS FOR FILE I/O
// -------------------------------------------------------------
function loadUsers() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            // Create a clean users.json file in the root folder if missing
            try {
                fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf8');
            } catch (wErr) {
                console.warn("Could not write initial users.json:", wErr.message);
            }
            return [];
        }

        const data = fs.readFileSync(DATA_FILE, 'utf8').trim();
        if (!data) return [];

        const parsed = JSON.parse(data);
        // Ensure the returned data is always an array
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error("Error reading/parsing users.json:", err.message);
        return [];
    }
}

function saveUsers(users) {
    try {
        const safeData = Array.isArray(users) ? users : [];
        fs.writeFileSync(DATA_FILE, JSON.stringify(safeData, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error("Error writing users.json:", err.message);
        return false;
    }
}

// -------------------------------------------------------------
// API ENDPOINTS
// -------------------------------------------------------------

// 1. CLIENT LOGIN
app.post('/api/login', (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({ success: false, message: "Email and password are required." });
        }

        const users = loadUsers();
        const user = users.find(u => u && u.email && u.email.toLowerCase() === email.toLowerCase().trim() && u.password === password);

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
    } catch (err) {
        console.error("Error in /api/login:", err);
        return res.status(500).json({ success: false, message: "Server error during login." });
    }
});

// 2. ADMIN: AUTHENTICATE & FETCH USER LIST
app.post('/api/admin/users', (req, res) => {
    try {
        const { adminKey } = req.body || {};

        if (adminKey !== OWNER_SECRET_KEY) {
            return res.status(403).json({ success: false, message: "Invalid owner secret key!" });
        }

        let users = loadUsers();

        // Extra safety check to prevent .map() errors
        if (!Array.isArray(users)) {
            users = [];
        }

        const sanitizedUsers = users.map(u => ({
            email: u && u.email ? u.email : "",
            title: u && u.title ? u.title : "Unnamed Device",
            buttonCount: u && Array.isArray(u.buttons) ? u.buttons.length : 0
        }));

        return res.json({ success: true, users: sanitizedUsers });
    } catch (err) {
        console.error("Critical error in /api/admin/users:", err);
        return res.status(500).json({ success: false, message: "Server error processing request: " + err.message });
    }
});

// 3. ADMIN: ADD NEW CLIENT ACCOUNT
app.post('/api/admin/add-user', (req, res) => {
    try {
        const { adminKey, email, password, title } = req.body || {};

        if (adminKey !== OWNER_SECRET_KEY) {
            return res.status(403).json({ success: false, message: "Unauthorized access." });
        }

        if (!email || !password || !title) {
            return res.status(400).json({ success: false, message: "All fields are required." });
        }

        let users = loadUsers();
        const normalizedEmail = email.toLowerCase().trim();

        if (users.some(u => u && u.email && u.email.toLowerCase() === normalizedEmail)) {
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
            return res.status(500).json({ success: false, message: "Failed to save client data to storage." });
        }
    } catch (err) {
        console.error("Error in /api/admin/add-user:", err);
        return res.status(500).json({ success: false, message: "Server error adding user." });
    }
});

// 4. ADMIN: DELETE CLIENT ACCOUNT
app.post('/api/admin/delete-user', (req, res) => {
    try {
        const { adminKey, targetEmail } = req.body || {};

        if (adminKey !== OWNER_SECRET_KEY) {
            return res.status(403).json({ success: false, message: "Unauthorized access." });
        }

        let users = loadUsers();
        const initialCount = users.length;
        users = users.filter(u => u && u.email && u.email.toLowerCase() !== targetEmail.toLowerCase().trim());

        if (users.length === initialCount) {
            return res.status(404).json({ success: false, message: "Target user not found." });
        }

        if (saveUsers(users)) {
            return res.json({ success: true, message: "Client account deleted successfully." });
        } else {
            return res.status(500).json({ success: false, message: "Failed to update storage." });
        }
    } catch (err) {
        console.error("Error in /api/admin/delete-user:", err);
        return res.status(500).json({ success: false, message: "Server error deleting user." });
    }
});

// 5. REGISTER / ADD DEVICE BUTTON TO CLIENT (via QR Code or Form)
app.post('/api/admin/add-button', (req, res) => {
    try {
        const { targetEmail, buttonName, pubTopic, subTopic, macAddr } = req.body || {};

        if (!targetEmail || !pubTopic || !subTopic) {
            return res.status(400).json({ success: false, message: "Missing required device fields." });
        }

        let users = loadUsers();
        const userIndex = users.findIndex(u => u && u.email && u.email.toLowerCase() === targetEmail.toLowerCase().trim());

        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: "Client account not found." });
        }

        if (!Array.isArray(users[userIndex].buttons)) {
            users[userIndex].buttons = [];
        }

        const newButton = {
            id: "btn_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
            name: buttonName || "New Appliance",
            pubTopic: pubTopic,
            subTopic: subTopic,
            mac: macAddr || "FF:FF:FF:FF:FF:FF"
        };

        users[userIndex].buttons.push(newButton);

        if (saveUsers(users)) {
            return res.json({ success: true, message: "Device button paired successfully.", button: newButton });
        } else {
            return res.status(500).json({ success: false, message: "Failed to save device pairing." });
        }
    } catch (err) {
        console.error("Error in /api/admin/add-button:", err);
        return res.status(500).json({ success: false, message: "Server error adding button." });
    }
});

// 6. CLIENT: DELETE DEVICE BUTTON
app.post('/api/client/delete-button', (req, res) => {
    try {
        const { email, buttonId } = req.body || {};

        if (!email || !buttonId) {
            return res.status(400).json({ success: false, message: "Email and Button ID are required." });
        }

        let users = loadUsers();
        const userIndex = users.findIndex(u => u && u.email && u.email.toLowerCase() === email.toLowerCase().trim());

        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: "Client account not found." });
        }

        if (Array.isArray(users[userIndex].buttons)) {
            const initialLength = users[userIndex].buttons.length;
            users[userIndex].buttons = users[userIndex].buttons.filter(b => b.id !== buttonId);

            if (users[userIndex].buttons.length === initialLength) {
                return res.status(404).json({ success: false, message: "Device button not found." });
            }
        }

        if (saveUsers(users)) {
            return res.json({ success: true, message: "Device deleted successfully." });
        } else {
            return res.status(500).json({ success: false, message: "Failed to delete device from server storage." });
        }
    } catch (err) {
        console.error("Error in /api/client/delete-button:", err);
        return res.status(500).json({ success: false, message: "Server error deleting button." });
    }
});

// -------------------------------------------------------------
// START SERVER (Listening on 0.0.0.0 required for Render)
// -------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=================================`);
    console.log(`ESP32 Controller Server Running  `);
    console.log(`Port: ${PORT}                    `);
    console.log(`=================================`);
});
