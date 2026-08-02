//node server.js

// server.js

const express = require('express');

const cors = require('cors');

const fs = require('fs');

const app = express();



app.use(cors());

app.use(express.json());



const DB_FILE = 'users.json';

// Secret key to access Owner Portal (Change this to your preferred password)

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'khaled';



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



// 1. CLIENT LOGIN ENDPOINT

app.post('/api/login', (req, res) => {

const { email, password } = req.body;

const users = getUsers();



if (users[email] && users[email].password === password) {

const { password: _, ...userData } = users[email];

userData.email = email;

res.json({ success: true, user: userData });

} else {

res.status(401).json({ success: false, message: 'Invalid email or password!' });

}

});



// 2. ADMIN: GET ALL USERS

app.post('/api/admin/users', (req, res) => {

const { adminKey } = req.body;

if (adminKey !== ADMIN_SECRET) {

return res.status(403).json({ success: false, message: 'Unauthorized: Invalid Admin Key!' });

}



const users = getUsers();

const safeUsers = Object.keys(users).map(email => ({

email: email,

title: users[email].title,

pubTopic: users[email].pubTopic,

subTopic: users[email].subTopic

}));



res.json({ success: true, users: safeUsers });

});



// 3. ADMIN: ADD NEW USER

app.post('/api/admin/add-user', (req, res) => {

const { adminKey, email, password, title, pubTopic, subTopic } = req.body;


if (adminKey !== ADMIN_SECRET) {

return res.status(403).json({ success: false, message: 'Unauthorized: Invalid Admin Key!' });

}



const users = getUsers();

if (users[email]) {

return res.status(400).json({ success: false, message: 'User/Email already exists!' });

}



users[email] = { password, title, pubTopic, subTopic };

saveUsers(users);



res.json({ success: true, message: 'Client account created successfully!' });

});



// 4. ADMIN: DELETE USER

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



// Start Server (Uses Render's PORT variable when deployed, or 3000 locally)

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

console.log(`Server running on port ${PORT}`);

}); 
