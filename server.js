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

// 1. CLIENT LOGIN / AUTO-REGISTER
const API_BASE_URL = ''; 

// STEP 1: Request the code to be sent to the email
async function sendVerificationCode() {
    const email = document.getElementById('emailInput').value;
    const messageEl = document.getElementById('loginMessage');
    
    if (!email) {
        messageEl.innerText = "Please enter your email.";
        messageEl.style.color = "red";
        return;
    }

    messageEl.innerText = "Sending code...";
    messageEl.style.color = "white";

    try {
        const response = await fetch(`${API_BASE_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email })
        });
        
        const data = await response.json();

        if (data.success && data.requireVerification) {
            // Hide the 'Send Code' button and show the Code input field
            document.getElementById('loginBtn').style.display = 'none';
            document.getElementById('codeInput').style.display = 'block';
            document.getElementById('verifyBtn').style.display = 'block';
            
            messageEl.innerText = "Check your email for the 6-digit code.";
            messageEl.style.color = "#00ff00"; // Green success text
        } else {
            messageEl.innerText = data.message || "Failed to send code.";
            messageEl.style.color = "red";
        }
    } catch (error) {
        console.error("Error:", error);
        messageEl.innerText = "Cannot connect to server!";
        messageEl.style.color = "red";
    }
}

// STEP 2: Verify the code and log the user in
async function verifyAndLogin() {
    const email = document.getElementById('emailInput').value;
    const code = document.getElementById('codeInput').value;
    const messageEl = document.getElementById('loginMessage');

    if (!code) {
        messageEl.innerText = "Please enter the verification code.";
        messageEl.style.color = "red";
        return;
    }

    messageEl.innerText = "Verifying...";
    messageEl.style.color = "white";

    try {
        const response = await fetch(`${API_BASE_URL}/api/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, code: code })
        });
        
        const data = await response.json();

        if (data.success) {
            messageEl.innerText = "Login successful!";
            messageEl.style.color = "#00ff00";
            
            // Save the user data locally so the dashboard can use it
            localStorage.setItem('currentUser', JSON.stringify(data.user));
            
            // Assuming you have a function to hide the login screen and show the dashboard:
            // loadDashboard(); 
            
        } else {
            messageEl.innerText = data.message || "Invalid code.";
            messageEl.style.color = "red";
        }
    } catch (error) {
        console.error("Error:", error);
        messageEl.innerText = "Cannot connect to server!";
        messageEl.style.color = "red";
    }
}

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
