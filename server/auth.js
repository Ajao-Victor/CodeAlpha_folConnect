const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const users = new Map();

router.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    if (users.has(email)) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = Date.now().toString(); // Simple ID generation
    users.set(email, { userId, username, email, password: hashedPassword });
    res.status(201).json({ message: 'User created', userId });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/signin', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = users.get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user.userId, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, userId: user.userId, username: user.username });
  } catch (err) {
    console.error('Signin error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

module.exports = { authRoutes: router, authenticateToken };


// const express = require('express');
// const bcrypt = require('bcrypt');
// const jwt = require('jsonwebtoken');
// const { Pool } = require('pg');

// const router = express.Router();
// const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';


// const pool = new Pool({
//   user: process.env.DB_USER || 'postgres',
//   host: 'localhost',
//   database: 'connectsphere_db',
//   password: process.env.DB_PASSWORD || 'your_password',
//   port: 5432,
// });

// router.post('/signup', async (req, res) => {
//   const { username, email, password } = req.body;
//   try {
//     const hashedPassword = await bcrypt.hash(password, 10);
//     const client = await pool.connect();
//     try {
//       const result = await client.query(
//         'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id',
//         [username, email, hashedPassword]
//       );
//       res.status(201).json({ message: 'User created', userId: result.rows[0].id });
//     } finally {
//       client.release();
//     }
//   } catch (err) {
//     console.error('Signup error:', err);
//     res.status(400).json({ error: 'Username or email already exists' });
//   }
// });

// router.post('/signin', async (req, res) => {
//   const { email, password } = req.body;
//   try {
//     const client = await pool.connect();
//     try {
//       const result = await client.query('SELECT * FROM users WHERE email = $1', [email]);
//       if (result.rows.length === 0) {
//         return res.status(401).json({ error: 'Invalid credentials' });
//       }
//       const user = result.rows[0];
//       const isValid = await bcrypt.compare(password, user.password);
//       if (!isValid) {
//         return res.status(401).json({ error: 'Invalid credentials' });
//       }
//       const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });
//       res.json({ token, userId: user.id, username: user.username });
//     } finally {
//       client.release();
//     }
//   } catch (err) {
//     console.error('Signin error:', err);
//     res.status(500).json({ error: 'Server error' });
//   }
// });

// function authenticateToken(req, res, next) {
//   const authHeader = req.headers['authorization'];
//   const token = authHeader && authHeader.split(' ')[1];
//   if (!token) return res.status(401).json({ error: 'Token required' });
//   jwt.verify(token, JWT_SECRET, (err, user) => {
//     if (err) return res.status(403).json({ error: 'Invalid token' });
//     req.user = user;
//     next();
//   });
// }

// module.exports = { authRoutes: router, authenticateToken };