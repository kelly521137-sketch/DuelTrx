// État global de l'application
let currentUser = null;
let authToken = null;
let socket = null;
let currentGame = null;

// Initialisation
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    setupEventListeners();
    
    // Vérifier si l'utilisateur est déjà connecté
    const savedToken = localStorage.getItem('authToken');
    if (savedToken) {
        authToken = savedToken;
        loadUserData();
    }
});

function initializeApp() {
    showPage('home');
    
    // Initialiser Socket.IO seulement si l'utilisateur est connecté
    if (authToken) {
        initializeSocket();
    }
}

function initializeSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connecté au serveur');
    });
    
    socket.on('queue_joined', (data) => {
        console.log('Rejoint la file d\'attente, position:', data.position);
    });
    
    socket.on('game_matched', (data) => {
        console.log('Match trouvé:', data);
        currentGame = data;
        showMatchFound(data);
    });
    
    socket.on('game_start', () => {
        console.log('Jeu démarré');
        showRaceScreen();
    });
    
    socket.on('progress_update', (data) => {
        updateProgressBars(data);
    });
    
    socket.on('game_finished', (data) => {
        console.log('Jeu terminé:', data);
        showGameResult(data);
        // Recharger le solde utilisateur
        loadUserData();
    });
    
    socket.on('error', (data) => {
        showNotification(data.message, 'error');
    });
    
    socket.on('disconnect', () => {
        console.log('Déconnecté du serveur');
    });
}

function setupEventListeners() {
    // Navigation
    document.getElementById('login-btn').addEventListener('click', () => showPage('login'));
    document.getElementById('register-btn').addEventListener('click', () => showPage('register'));
    document.getElementById('profile-btn').addEventListener('click', () => {
        loadProfile();
        showPage('profile');
    });
    document.getElementById('logout-btn').addEventListener('click', logout);
    document.getElementById('play-btn').addEventListener('click', startMatchmaking);
    
    // Basculer entre login et register
    document.getElementById('switch-to-register').addEventListener('click', () => showPage('register'));
    document.getElementById('switch-to-login').addEventListener('click', () => showPage('login'));
    
    // Formulaires
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegister);
    
    // Profil
    document.getElementById('back-to-home').addEventListener('click', () => showPage('home'));
    document.getElementById('deposit-btn').addEventListener('click', handleDeposit);
    document.getElementById('withdraw-btn').addEventListener('click', handleWithdraw);
    
    // Jeu
    document.getElementById('leave-queue-btn').addEventListener('click', leaveQueue);
    document.getElementById('click-btn').addEventListener('click', gameClick);
    document.getElementById('play-again-btn').addEventListener('click', startMatchmaking);
    document.getElementById('back-home-btn').addEventListener('click', () => showPage('home'));
    
    // Touche espace pour cliquer
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && document.getElementById('race-section').style.display !== 'none') {
            e.preventDefault();
            gameClick();
        }
    });
}

function showPage(pageName) {
    // Cacher toutes les pages
    const pages = ['home', 'login', 'register', 'profile', 'game'];
    pages.forEach(page => {
        document.getElementById(page + '-page').classList.add('hidden');
    });
    
    // Afficher la page demandée
    document.getElementById(pageName + '-page').classList.remove('hidden');
    
    // Mettre à jour la navigation
    updateNavigation();
}

function updateNavigation() {
    const userNav = document.getElementById('user-nav');
    const guestNav = document.getElementById('guest-nav');
    const playBtn = document.getElementById('play-btn');
    
    if (currentUser) {
        userNav.classList.remove('hidden');
        userNav.classList.add('flex');
        guestNav.classList.add('hidden');
        playBtn.classList.remove('hidden');
        
        document.getElementById('user-username').textContent = currentUser.username;
        document.getElementById('user-balance').textContent = currentUser.balance_points || 0;
    } else {
        userNav.classList.add('hidden');
        guestNav.classList.remove('hidden');
        playBtn.classList.add('hidden');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem('authToken', authToken);
            
            initializeSocket();
            showNotification('Connexion réussie !', 'success');
            showPage('home');
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Erreur de connexion', 'error');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    
    const email = document.getElementById('register-email').value;
    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    
    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem('authToken', authToken);
            
            initializeSocket();
            showNotification('Inscription réussie ! Vous avez reçu 100 points gratuits !', 'success');
            showPage('home');
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Erreur lors de l\'inscription', 'error');
    }
}

async function loadUserData() {
    try {
        const response = await fetch('/api/user/me', {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            currentUser = await response.json();
            updateNavigation();
        } else {
            logout();
        }
    } catch (error) {
        console.error('Erreur lors du chargement des données utilisateur:', error);
    }
}

function logout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    
    showPage('home');
    showNotification('Déconnexion réussie', 'info');
}

async function loadProfile() {
    try {
        // Charger les données utilisateur
        await loadUserData();
        
        // Mettre à jour les éléments du profil
        document.getElementById('profile-balance').textContent = currentUser.balance_points || 0;
        document.getElementById('profile-wins').textContent = currentUser.wins || 0;
        document.getElementById('profile-losses').textContent = currentUser.losses || 0;
        
        // Charger l'historique des transactions
        const response = await fetch('/api/transactions', {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const transactions = await response.json();
            displayTransactions(transactions);
        }
    } catch (error) {
        showNotification('Erreur lors du chargement du profil', 'error');
    }
}

function displayTransactions(transactions) {
    const container = document.getElementById('transactions-list');
    container.innerHTML = '';
    
    if (transactions.length === 0) {
        container.innerHTML = '<p class=\"text-gray-500 text-center\">Aucune transaction</p>';
        return;
    }
    
    transactions.forEach(transaction => {
        const div = document.createElement('div');
        div.className = 'flex justify-between items-center p-3 bg-gray-50 rounded-lg';
        
        const typeIcons = {
            'deposit': 'fas fa-plus text-green-500',
            'withdraw': 'fas fa-minus text-red-500',
            'bet': 'fas fa-dice text-blue-500',
            'payout': 'fas fa-trophy text-yellow-500'
        };
        
        const typeNames = {
            'deposit': 'Dépôt',
            'withdraw': 'Retrait',
            'bet': 'Mise',
            'payout': 'Gain'
        };
        
        div.innerHTML = `
            <div class="flex items-center">
                <i class="${typeIcons[transaction.type] || 'fas fa-circle'} mr-2"></i>
                <span class="font-medium">${typeNames[transaction.type] || transaction.type}</span>
            </div>
            <div class="text-right">
                <div class="font-bold ${transaction.amount > 0 ? 'text-green-600' : 'text-red-600'}">
                    ${transaction.amount > 0 ? '+' : ''}${transaction.amount} points
                </div>
                <div class="text-xs text-gray-500">
                    ${new Date(transaction.created_at).toLocaleDateString()}
                </div>
            </div>
        `;
        
        container.appendChild(div);
    });
}

async function handleDeposit() {
    const amount = parseFloat(document.getElementById('deposit-amount').value);
    
    if (!amount || amount < 10) {
        showNotification('Montant minimum: 10 points', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/wallet/deposit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ amount })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showNotification('Dépôt effectué avec succès !', 'success');
            document.getElementById('deposit-amount').value = '';
            loadProfile();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Erreur lors du dépôt', 'error');
    }
}

async function handleWithdraw() {
    const amount = parseFloat(document.getElementById('withdraw-amount').value);
    
    if (!amount || amount < 50) {
        showNotification('Montant minimum: 50 points', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/wallet/withdraw', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ amount })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showNotification('Retrait effectué avec succès !', 'success');
            document.getElementById('withdraw-amount').value = '';
            loadProfile();
        } else {
            showNotification(data.error, 'error');
        }
    } catch (error) {
        showNotification('Erreur lors du retrait', 'error');
    }
}

function startMatchmaking() {
    if (!authToken) {
        showNotification('Vous devez vous connecter pour jouer', 'error');
        return;
    }
    
    if (!currentUser || currentUser.balance_points < 2) {
        showNotification('Solde insuffisant (minimum 2 points)', 'error');
        return;
    }
    
    showPage('game');
    showGameSection('queue');
    
    socket.emit('join_queue', { token: authToken });
}

function leaveQueue() {
    socket.emit('leave_queue');
    showPage('home');
}

function showGameSection(section) {
    const sections = ['queue', 'match', 'race', 'result'];
    sections.forEach(s => {
        document.getElementById(s + '-section').classList.add('hidden');
    });
    document.getElementById(section + '-section').classList.remove('hidden');
}

function showMatchFound(gameData) {
    showGameSection('match');
    
    // Déterminer qui est qui
    const isPlayer1 = gameData.playerNumber === 1;
    const playerName = currentUser.username;
    const opponentName = gameData.opponent;
    
    if (isPlayer1) {
        document.getElementById('player1-name').textContent = playerName;
        document.getElementById('player1-initial').textContent = playerName[0].toUpperCase();
        document.getElementById('player2-name').textContent = opponentName;
        document.getElementById('player2-initial').textContent = opponentName[0].toUpperCase();
    } else {
        document.getElementById('player1-name').textContent = opponentName;
        document.getElementById('player1-initial').textContent = opponentName[0].toUpperCase();
        document.getElementById('player2-name').textContent = playerName;
        document.getElementById('player2-initial').textContent = playerName[0].toUpperCase();
    }
    
    document.getElementById('pot-amount').textContent = gameData.pot + ' points';
    
    // Countdown
    let countdown = 3;
    const countdownElement = document.getElementById('countdown');
    const interval = setInterval(() => {
        countdown--;
        countdownElement.textContent = countdown;
        if (countdown <= 0) {
            clearInterval(interval);
        }
    }, 1000);
}

function showRaceScreen() {
    showGameSection('race');
    
    // Réinitialiser les barres de progression
    document.getElementById('player1-progress-bar').style.width = '0%';
    document.getElementById('player2-progress-bar').style.width = '0%';
    document.getElementById('player1-progress-text').textContent = '0%';
    document.getElementById('player2-progress-text').textContent = '0%';
    
    // Copier les noms
    document.getElementById('race-player1-name').textContent = document.getElementById('player1-name').textContent;
    document.getElementById('race-player2-name').textContent = document.getElementById('player2-name').textContent;
}

function gameClick() {
    if (socket && currentGame) {
        socket.emit('game_click', { gameId: currentGame.gameId });
    }
}

function updateProgressBars(data) {
    const player1Progress = (data.player1Progress / 50) * 100;
    const player2Progress = (data.player2Progress / 50) * 100;
    
    document.getElementById('player1-progress-bar').style.width = player1Progress + '%';
    document.getElementById('player2-progress-bar').style.width = player2Progress + '%';
    document.getElementById('player1-progress-text').textContent = Math.round(player1Progress) + '%';
    document.getElementById('player2-progress-text').textContent = Math.round(player2Progress) + '%';
}

function showGameResult(data) {
    showGameSection('result');
    
    if (data.result === 'win') {
        document.getElementById('win-result').classList.remove('hidden');
        document.getElementById('lose-result').classList.add('hidden');
        document.getElementById('win-amount').textContent = data.payout;
    } else {
        document.getElementById('win-result').classList.add('hidden');
        document.getElementById('lose-result').classList.remove('hidden');
        document.getElementById('winner-name').textContent = data.winner;
    }
    
    currentGame = null;
}

function showNotification(message, type) {
    const container = document.getElementById('notifications');
    const notification = document.createElement('div');
    
    const colors = {
        'success': 'bg-green-500',
        'error': 'bg-red-500',
        'info': 'bg-blue-500',
        'warning': 'bg-yellow-500'
    };
    
    notification.className = `${colors[type] || colors.info} text-white px-6 py-3 rounded-lg shadow-lg transform transition-all duration-500 opacity-0 translate-x-full`;
    notification.innerHTML = `
        <div class="flex items-center">
            <span>${message}</span>
            <button class="ml-4 text-white hover:text-gray-200" onclick="this.parentElement.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    container.appendChild(notification);
    
    // Animation d'entrée
    setTimeout(() => {
        notification.classList.remove('opacity-0', 'translate-x-full');
    }, 100);
    
    // Auto-suppression après 5 secondes
    setTimeout(() => {
        if (notification.parentElement) {
            notification.classList.add('opacity-0', 'translate-x-full');
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.remove();
                }
            }, 500);
        }
    }, 5000);
}