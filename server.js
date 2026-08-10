const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const existsSync = require('fs').existsSync;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'users.json');

// Configuration from Environment Variables
const OWNER_SECRET_KEY = process.env.ADMIN_SECRET || "admin123";

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json());
app.use(express.static(__dirname));

// Asynchronous File Helpers
async function loadUsers() {
    try {
        if (!existsSync(DATA_FILE)) {
            await fs.writeFile(DATA_FILE, JSON.stringify([], null, 2), 'utf8');
            return [];
        }
        const data = (await fs.readFile(DATA_FILE, 'utf8')).trim();
        if (!data) return [];
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error("Error reading users.json:", err.message);
        return [];
    }
}

async function saveUsers(users) {
    try {
        const safeData = Array.isArray(users) ? users : [];
        await fs.writeFile(DATA_FILE, JSON.stringify(safeData, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error("Error writing users.json:", err.message);
        return false;
    }
}

// 1. CLIENT LOGIN
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ success: false, message: "Email and password are required." });
        }

        const users = await loadUsers();
        const user = users.find(u => u?.email?.toLowerCase() === email.toLowerCase().trim() && u.password === password);

        if (user) {
            return res.json({
                success: true,
                user: {
                    email: user.email,
                    title: user.title,
                    buttons: user.buttons || []
                }
            });
        }
        return res.status(401).json({ success: false, message: "Invalid email or password." });
    } catch (err) {
        console.error("Error in /api/login:", err);
        return res.status(500).json({ success: false, message: "Server error during login." });
    }
});

// 2. ADMIN: FETCH USER LIST
app.post('/api/admin/users', async (req, res) => {
    try {
        const { adminKey } = req.body || {};
        if (adminKey !== OWNER_SECRET_KEY) {
            return res.status(403).json({ success: false, message: "Invalid owner secret key!" });
        }

        const users = await loadUsers();
        const sanitizedUsers = users.map(u => ({
            email: u?.email || "",
            title: u?.title || "Unnamed Device",
            buttonCount: Array.isArray(u?.buttons) ? u.buttons.length : 0
        }));

        return res.json({ success: true, users: sanitizedUsers });
    } catch (err) {
        console.error("Error in /api/admin/users:", err);
        return res.status(500).json({ success: false, message: "Server error." });
    }
});

// 3. ADMIN: ADD CLIENT
app.post('/api/admin/add-user', async (req, res) => {
    try {
        const { adminKey, email, password, title } = req.body || {};
        if (adminKey !== OWNER_SECRET_KEY) {
            return res.status(403).json({ success: false, message: "Unauthorized access." });
        }
        if (!email || !password || !title) {
            return res.status(400).json({ success: false, message: "All fields are required." });
        }

        const users = await loadUsers();
        const normalizedEmail = email.toLowerCase().trim();

        if (users.some(u => u?.email?.toLowerCase() === normalizedEmail)) {
            return res.status(400).json({ success: false, message: "Client email already exists." });
        }

        users.push({
            email: normalizedEmail,
            password: password,
            title: title,
            buttons: []
        });

        if (await saveUsers(users)) {
            return res.json({ success: true, message: "Client account created successfully." });
        }
        return res.status(500).json({ success: false, message: "Failed to save client data." });
    } catch (err) {
        console.error("Error in /api/admin/add-user:", err);
        return res.status(500).json({ success: false, message: "Server error adding user." });
    }
});

// 4. ADMIN: DELETE CLIENT
app.post('/api/admin/delete-user', async (req, res) => {
    try {
        const { adminKey, targetEmail } = req.body || {};
        if (adminKey !== OWNER_SECRET_KEY) {
            return res.status(403).json({ success: false, message: "Unauthorized access." });
        }
        if (!targetEmail) {
            return res.status(400).json({ success: false, message: "Target email is required." });
        }

        let users = await loadUsers();
        const initialCount = users.length;
        users = users.filter(u => u?.email?.toLowerCase() !== targetEmail.toLowerCase().trim());

        if (users.length === initialCount) {
            return res.status(404).json({ success: false, message: "Target user not found." });
        }

        if (await saveUsers(users)) {
            return res.json({ success: true, message: "Client account deleted successfully." });
        }
        return res.status(500).json({ success: false, message: "Failed to update storage." });
    } catch (err) {
        console.error("Error in /api/admin/delete-user:", err);
        return res.status(500).json({ success: false, message: "Server error deleting user." });
    }
});

// 5. REGISTER / PAIR DEVICE BUTTON
app.post('/api/admin/add-button', async (req, res) => {
    try {
        const { targetEmail, buttonName, pubTopic, subTopic, macAddr, customId } = req.body || {};
        if (!targetEmail || !pubTopic || !subTopic) {
            return res.status(400).json({ success: false, message: "Missing required device fields." });
        }

        let users = await loadUsers();
        const userIndex = users.findIndex(u => u?.email?.toLowerCase() === targetEmail.toLowerCase().trim());

        if (userIndex === -1) {
            return res.status(404).json({ success: false, message: "Client account not found." });
        }

        if (!Array.isArray(users[userIndex].buttons)) {
            users[userIndex].buttons = [];
        }

        const existingBtnIndex = users[userIndex].buttons.findIndex(
            b => b.pubTopic === pubTopic && b.subTopic === subTopic
        );

        let targetButton;
        if (existingBtnIndex !== -1) {
            users[userIndex].buttons[existingBtnIndex].name = buttonName || users[userIndex].buttons[existingBtnIndex].name;
            users[userIndex].buttons[existingBtnIndex].mac = macAddr || users[userIndex].buttons[existingBtnIndex].mac;
            targetButton = users[userIndex].buttons[existingBtnIndex];
        } else {
            const generatedId = customId || ("btn_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7));
            targetButton = {
                id: generatedId,
                name: buttonName || "New Appliance",
                pubTopic: pubTopic,
                subTopic: subTopic,
                mac: macAddr || "FF:FF:FF:FF:FF:FF"
            };
            users[userIndex].buttons.push(targetButton);
        }

        if (await saveUsers(users)) {
            return res.json({ success: true, message: "Device button paired successfully.", button: targetButton });
        }
        return res.status(500).json({ success: false, message: "Failed to save device pairing." });
    } catch (err) {
        console.error("Error in /api/admin/add-button:", err);
        return res.status(500).json({ success: false, message: "Server error adding button." });
    }
});

// 6. CLIENT: DELETE BUTTON
app.post('/api/client/delete-button', async (req, res) => {
    try {
        const { email, buttonId } = req.body || {};
        if (!email || !buttonId) {
            return res.status(400).json({ success: false, message: "Email and Button ID are required." });
        }

        let users = await loadUsers();
        const userIndex = users.findIndex(u => u?.email?.toLowerCase() === email.toLowerCase().trim());

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

        if (await saveUsers(users)) {
            return res.json({ success: true, message: "Device deleted successfully." });
        }
        return res.status(500).json({ success: false, message: "Failed to delete device." });
    } catch (err) {
        console.error("Error in /api/client/delete-button:", err);
        return res.status(500).json({ success: false, message: "Server error deleting button." });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
