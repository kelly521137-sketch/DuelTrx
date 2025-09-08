const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const TronService = require('./tronService');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configuration de la base de données
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.set('trust proxy', true); // Fix pour express-rate-limit
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limite à 100 requêtes par fenêtre par IP
  trustProxy: false // Fix pour éviter les warnings
});
app.use('/api', limiter);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Initialiser le service Tron
const tronService = new TronService();

// Middleware d'authentification
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token d\'accès requis' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token invalide' });
    }
    req.user = user;
    next();
  });
};

// File d'attente des joueurs
let gameQueue = [];
let activeGames = new Map();

// Routes d'authentification
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;

    if (!email || !password || !username) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    // Vérifier si l'utilisateur existe déjà
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email ou nom d\'utilisateur déjà utilisé' });
    }

    // Hash du mot de passe
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Générer une adresse de dépôt TRX unique
    const depositAccount = tronService.generateDepositAddress();
    const encryptedPrivateKey = tronService.encryptPrivateKey(depositAccount.privateKey);

    // Créer l'utilisateur avec adresse TRX
    const newUser = await pool.query(
      'INSERT INTO users (email, password_hash, username, balance_trx, deposit_address, address_private_key) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, username, balance_trx, deposit_address',
      [email, passwordHash, username, 0.0, depositAccount.address, encryptedPrivateKey]
    );

    const token = jwt.sign({ userId: newUser.rows[0].id }, JWT_SECRET);

    res.status(201).json({
      message: 'Utilisateur créé avec succès',
      token,
      user: newUser.rows[0]
    });
  } catch (error) {
    console.error('Erreur lors de l\'inscription:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await pool.query(
      'SELECT id, email, password_hash, username, balance_trx, deposit_address, wins, losses FROM users WHERE email = $1',
      [email]
    );

    if (user.rows.length === 0) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const validPassword = await bcrypt.compare(password, user.rows[0].password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const token = jwt.sign({ userId: user.rows[0].id }, JWT_SECRET);

    res.json({
      message: 'Connexion réussie',
      token,
      user: {
        id: user.rows[0].id,
        email: user.rows[0].email,
        username: user.rows[0].username,
        balance_trx: user.rows[0].balance_trx,
        deposit_address: user.rows[0].deposit_address,
        wins: user.rows[0].wins,
        losses: user.rows[0].losses
      }
    });
  } catch (error) {
    console.error('Erreur lors de la connexion:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Routes utilisateur
app.get('/api/user/me', authenticateToken, async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT id, email, username, balance_trx, deposit_address, wins, losses, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json(user.rows[0]);
  } catch (error) {
    console.error('Erreur lors de la récupération du profil:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const transactions = await pool.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [req.user.userId]
    );

    res.json(transactions.rows);
  } catch (error) {
    console.error('Erreur lors de la récupération des transactions:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Générer une adresse de dépôt pour l'utilisateur
app.get('/api/wallet/deposit-address', authenticateToken, async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT deposit_address FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json({
      address: user.rows[0].deposit_address,
      network: 'TRON (TRX)',
      minAmount: 2.0,
      note: 'Envoyez au moins 2 TRX à cette adresse. Les dépôts sont vérifiés automatiquement.'
    });
  } catch (error) {
    console.error('Erreur récupération adresse dépôt:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Vérifier les dépôts entrants
app.post('/api/wallet/check-deposits', authenticateToken, async (req, res) => {
  try {
    const user = await pool.query(
      'SELECT deposit_address FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const address = user.rows[0].deposit_address;
    const balance = await tronService.getAddressBalance(address);
    
    if (balance >= 2.0) {
      // Il y a des fonds - les transférer vers le solde utilisateur
      await pool.query('BEGIN');
      
      const updatedUser = await pool.query(
        'UPDATE users SET balance_trx = balance_trx + $1 WHERE id = $2 RETURNING balance_trx',
        [balance, req.user.userId]
      );
      
      await pool.query(
        'INSERT INTO transactions (user_id, type, amount, trx_amount, tron_address, status) VALUES ($1, $2, $3, $4, $5, $6)',
        [req.user.userId, 'deposit', balance, balance, address, 'confirmed']
      );
      
      await pool.query('COMMIT');
      
      res.json({
        success: true,
        amount: balance,
        newBalance: updatedUser.rows[0].balance_trx,
        message: `Dépôt de ${balance} TRX confirmé !`
      });
    } else {
      res.json({
        success: false,
        balance: balance,
        message: 'Aucun dépôt détecté ou montant insuffisant'
      });
    }
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Erreur vérification dépôts:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/wallet/withdraw', authenticateToken, async (req, res) => {
  try {
    const { amount, address } = req.body;

    if (!amount || amount < 5.0) {
      return res.status(400).json({ error: 'Montant minimum de retrait: 5 TRX' });
    }

    if (!address || !tronService.isValidAddress(address)) {
      return res.status(400).json({ error: 'Adresse TRX invalide' });
    }

    const user = await pool.query(
      'SELECT balance_trx, address_private_key FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (user.rows[0].balance_trx < amount) {
      return res.status(400).json({ error: 'Solde insuffisant' });
    }

    // Estimer les frais
    const estimatedFee = await tronService.estimateTransactionFee(
      user.rows[0].deposit_address, address, amount
    );
    
    const totalNeeded = amount + estimatedFee;
    if (user.rows[0].balance_trx < totalNeeded) {
      return res.status(400).json({ 
        error: `Solde insuffisant pour couvrir les frais. Nécessaire: ${totalNeeded} TRX (${amount} + ${estimatedFee} frais)` 
      });
    }

    await pool.query('BEGIN');

    try {
      // Déchiffrer la clé privée
      const privateKey = tronService.decryptPrivateKey(user.rows[0].address_private_key);
      
      // Envoyer la transaction
      const result = await tronService.sendTRX(privateKey, address, amount);
      
      if (!result.success) {
        await pool.query('ROLLBACK');
        return res.status(400).json({ error: result.error });
      }

      // Mettre à jour le solde
      const updatedUser = await pool.query(
        'UPDATE users SET balance_trx = balance_trx - $1 WHERE id = $2 RETURNING balance_trx',
        [totalNeeded, req.user.userId]
      );

      // Enregistrer la transaction
      await pool.query(
        'INSERT INTO transactions (user_id, type, amount, trx_amount, tron_address, transaction_hash, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [req.user.userId, 'withdraw', amount, amount, address, result.txid, 'confirmed']
      );

      await pool.query('COMMIT');

      res.json({
        success: true,
        message: 'Retrait effectué avec succès',
        txid: result.txid,
        amount: amount,
        fee: estimatedFee,
        newBalance: updatedUser.rows[0].balance_trx
      });
    } catch (txError) {
      await pool.query('ROLLBACK');
      console.error('Erreur transaction TRX:', txError);
      res.status(500).json({ error: 'Erreur lors de l\'envoi de la transaction' });
    }
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Erreur lors du retrait:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Socket.IO pour le jeu en temps réel
io.on('connection', (socket) => {
  console.log('Utilisateur connecté:', socket.id);

  socket.on('join_queue', async (data) => {
    try {
      const { token } = data;
      const decoded = jwt.verify(token, JWT_SECRET);
      
      const user = await pool.query(
        'SELECT id, username, balance_trx FROM users WHERE id = $1',
        [decoded.userId]
      );

      if (user.rows.length === 0) {
        socket.emit('error', { message: 'Utilisateur non trouvé' });
        return;
      }

      const userData = user.rows[0];
      
      if (userData.balance_trx < 2) {
        socket.emit('error', { message: 'Solde insuffisant (minimum 2 TRX)' });
        return;
      }

      // Vérifier si l'utilisateur n'est pas déjà en file
      const alreadyInQueue = gameQueue.find(p => p.userId === userData.id);
      if (alreadyInQueue) {
        socket.emit('error', { message: 'Déjà en file d\'attente' });
        return;
      }

      // Ajouter à la file d'attente
      const player = {
        userId: userData.id,
        username: userData.username,
        socketId: socket.id,
        balance: userData.balance_trx
      };

      socket.userId = userData.id;
      gameQueue.push(player);

      socket.emit('queue_joined', { position: gameQueue.length });

      // Vérifier si on peut faire un match
      if (gameQueue.length >= 2) {
        const player1 = gameQueue.shift();
        const player2 = gameQueue.shift();

        startGame(player1, player2);
      }
    } catch (error) {
      console.error('Erreur join_queue:', error);
      socket.emit('error', { message: 'Erreur lors de l\'ajout à la file' });
    }
  });

  socket.on('leave_queue', () => {
    gameQueue = gameQueue.filter(p => p.socketId !== socket.id);
    socket.emit('queue_left');
  });

  socket.on('game_click', async (data) => {
    const game = activeGames.get(socket.userId);
    if (!game || game.status !== 'started') {
      return;
    }

    if (game.player1.userId === socket.userId) {
      game.player1.progress++;
    } else if (game.player2.userId === socket.userId) {
      game.player2.progress++;
    }

    // Broadcast la progression
    io.to(game.player1.socketId).emit('progress_update', {
      player1Progress: game.player1.progress,
      player2Progress: game.player2.progress
    });
    io.to(game.player2.socketId).emit('progress_update', {
      player1Progress: game.player1.progress,
      player2Progress: game.player2.progress
    });

    // Vérifier la victoire
    if (game.player1.progress >= 50 || game.player2.progress >= 50) {
      const winner = game.player1.progress >= 50 ? game.player1 : game.player2;
      const loser = winner === game.player1 ? game.player2 : game.player1;
      
      await endGame(game, winner, loser);
    }
  });

  socket.on('disconnect', () => {
    console.log('Utilisateur déconnecté:', socket.id);
    // Retirer de la file d'attente
    gameQueue = gameQueue.filter(p => p.socketId !== socket.id);
    
    // Gérer la déconnexion pendant un jeu
    if (socket.userId && activeGames.has(socket.userId)) {
      const game = activeGames.get(socket.userId);
      if (game.status === 'started') {
        // Déclarer l'autre joueur gagnant
        const winner = game.player1.userId === socket.userId ? game.player2 : game.player1;
        const loser = game.player1.userId === socket.userId ? game.player1 : game.player2;
        endGame(game, winner, loser);
      }
    }
  });
});

async function startGame(player1, player2) {
  try {
    const stake = 2.0;
    const pot = stake * 2;

    // Débiter les comptes
    await pool.query('BEGIN');

    await pool.query(
      'UPDATE users SET balance_trx = balance_trx - $1 WHERE id = $2',
      [stake, player1.userId]
    );

    await pool.query(
      'UPDATE users SET balance_trx = balance_trx - $1 WHERE id = $2',
      [stake, player2.userId]
    );

    // Créer le jeu en base
    const gameResult = await pool.query(
      'INSERT INTO games (player1_id, player2_id, stake, pot, status, started_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id',
      [player1.userId, player2.userId, stake, pot, 'started']
    );

    const gameId = gameResult.rows[0].id;

    // Enregistrer les mises
    await pool.query(
      'INSERT INTO transactions (user_id, type, amount, status) VALUES ($1, $2, $3, $4)',
      [player1.userId, 'bet', stake, 'confirmed']
    );

    await pool.query(
      'INSERT INTO transactions (user_id, type, amount, status) VALUES ($1, $2, $3, $4)',
      [player2.userId, 'bet', stake, 'confirmed']
    );

    await pool.query('COMMIT');

    // Créer l'objet du jeu
    const game = {
      id: gameId,
      player1: { ...player1, progress: 0 },
      player2: { ...player2, progress: 0 },
      stake,
      pot,
      status: 'started',
      startTime: Date.now()
    };

    activeGames.set(player1.userId, game);
    activeGames.set(player2.userId, game);

    // Notifier les joueurs
    io.to(player1.socketId).emit('game_matched', {
      gameId,
      opponent: player2.username,
      stake,
      pot,
      playerNumber: 1
    });

    io.to(player2.socketId).emit('game_matched', {
      gameId,
      opponent: player1.username,
      stake,
      pot,
      playerNumber: 2
    });

    setTimeout(() => {
      io.to(player1.socketId).emit('game_start');
      io.to(player2.socketId).emit('game_start');
    }, 3000);

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Erreur lors du démarrage du jeu:', error);
  }
}

async function endGame(game, winner, loser) {
  try {
    await pool.query('BEGIN');

    const winnerPayout = game.pot * 0.85;
    const systemFee = game.pot * 0.15;

    // Payer le gagnant
    await pool.query(
      'UPDATE users SET balance_trx = balance_trx + $1, wins = wins + 1 WHERE id = $2',
      [winnerPayout, winner.userId]
    );

    // Incrémenter les défaites du perdant
    await pool.query(
      'UPDATE users SET losses = losses + 1 WHERE id = $1',
      [loser.userId]
    );

    // Mettre à jour le jeu
    await pool.query(
      'UPDATE games SET winner_id = $1, status = $2, finished_at = NOW() WHERE id = $3',
      [winner.userId, 'finished', game.id]
    );

    // Enregistrer les transactions
    await pool.query(
      'INSERT INTO transactions (user_id, type, amount, status) VALUES ($1, $2, $3, $4)',
      [winner.userId, 'payout', winnerPayout, 'confirmed']
    );

    await pool.query(
      'INSERT INTO transactions (user_id, type, amount, status) VALUES ($1, $2, $3, $4)',
      [null, 'fee', systemFee, 'confirmed']
    );

    await pool.query('COMMIT');

    // Notifier les joueurs
    io.to(winner.socketId).emit('game_finished', {
      result: 'win',
      payout: winnerPayout,
      winner: winner.username
    });

    io.to(loser.socketId).emit('game_finished', {
      result: 'lose',
      payout: 0,
      winner: winner.username
    });

    // Nettoyer les jeux actifs
    activeGames.delete(game.player1.userId);
    activeGames.delete(game.player2.userId);

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Erreur lors de la fin du jeu:', error);
  }
}

// Route pour servir la page principale
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur démarré sur le port ${PORT} en mode ${process.env.NODE_ENV || 'development'}`);
});