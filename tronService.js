const { TronWeb } = require('tronweb');
const crypto = require('crypto');

class TronService {
    constructor() {
        // Configuration Tron (mainnet par défaut)
        this.tronWeb = new TronWeb({
            fullHost: process.env.TRON_NODE_URL || 'https://api.trongrid.io',
            headers: { "TRON-PRO-API-KEY": process.env.TRON_API_KEY || '' },
            privateKey: process.env.MASTER_PRIVATE_KEY || ''
        });
        
        // Adresse système pour recevoir les frais (15%)
        this.systemAddress = process.env.SYSTEM_ADDRESS || 'TKkmV7s4Aszz5Luw9NnPT1Qgr3Ng4LNvcW';
        
        // Clé de chiffrement pour les clés privées en base
        this.encryptionKey = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production';
    }

    // Générer une nouvelle adresse de dépôt pour un utilisateur
    generateDepositAddress() {
        try {
            const account = this.tronWeb.createAccount();
            return {
                address: account.address.base58,
                privateKey: account.privateKey,
                publicKey: account.publicKey
            };
        } catch (error) {
            console.error('Erreur génération adresse:', error);
            throw new Error('Impossible de générer une adresse');
        }
    }

    // Chiffrer une clé privée
    encryptPrivateKey(privateKey) {
        const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
        let encrypted = cipher.update(privateKey, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted;
    }

    // Déchiffrer une clé privée
    decryptPrivateKey(encryptedPrivateKey) {
        const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
        let decrypted = decipher.update(encryptedPrivateKey, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    // Vérifier le solde d'une adresse en TRX
    async getAddressBalance(address) {
        try {
            const balance = await this.tronWeb.trx.getBalance(address);
            return this.tronWeb.fromSun(balance); // Convertir de Sun en TRX
        } catch (error) {
            console.error('Erreur récupération solde:', error);
            return 0;
        }
    }

    // Obtenir les détails d'une transaction
    async getTransaction(txHash) {
        try {
            const transaction = await this.tronWeb.trx.getTransaction(txHash);
            if (!transaction || !transaction.txID) {
                return null;
            }

            const transactionInfo = await this.tronWeb.trx.getTransactionInfo(txHash);
            
            return {
                txid: transaction.txID,
                confirmed: transactionInfo.blockNumber ? true : false,
                amount: transaction.raw_data?.contract?.[0]?.parameter?.value?.amount ? 
                        this.tronWeb.fromSun(transaction.raw_data.contract[0].parameter.value.amount) : 0,
                from: transaction.raw_data?.contract?.[0]?.parameter?.value?.owner_address ? 
                      this.tronWeb.address.fromHex(transaction.raw_data.contract[0].parameter.value.owner_address) : '',
                to: transaction.raw_data?.contract?.[0]?.parameter?.value?.to_address ? 
                    this.tronWeb.address.fromHex(transaction.raw_data.contract[0].parameter.value.to_address) : '',
                timestamp: transaction.raw_data?.timestamp || Date.now(),
                fee: transactionInfo.fee || 0
            };
        } catch (error) {
            console.error('Erreur récupération transaction:', error);
            return null;
        }
    }

    // Surveiller les transactions entrantes vers une adresse
    async getIncomingTransactions(address, startTimestamp = 0) {
        try {
            const transactions = await this.tronWeb.trx.getTransactionsFromAddress(address, 50);
            const incomingTxs = [];

            for (const tx of transactions) {
                if (tx.raw_data?.timestamp > startTimestamp) {
                    const contract = tx.raw_data?.contract?.[0];
                    if (contract?.type === 'TransferContract') {
                        const toAddress = this.tronWeb.address.fromHex(contract.parameter.value.to_address);
                        if (toAddress === address) {
                            const amount = this.tronWeb.fromSun(contract.parameter.value.amount);
                            incomingTxs.push({
                                txid: tx.txID,
                                amount: parseFloat(amount),
                                from: this.tronWeb.address.fromHex(contract.parameter.value.owner_address),
                                timestamp: tx.raw_data.timestamp
                            });
                        }
                    }
                }
            }

            return incomingTxs;
        } catch (error) {
            console.error('Erreur surveillance transactions:', error);
            return [];
        }
    }

    // Envoyer des TRX depuis une adresse
    async sendTRX(fromPrivateKey, toAddress, amount) {
        try {
            // Créer une instance TronWeb temporaire avec la clé privée de l'expéditeur
            const tempTronWeb = new TronWeb({
                fullHost: this.tronWeb.fullHost,
                headers: this.tronWeb.headers,
                privateKey: fromPrivateKey
            });

            const fromAddress = tempTronWeb.defaultAddress.base58;
            const amountInSun = tempTronWeb.toSun(amount);

            // Vérifier le solde
            const balance = await tempTronWeb.trx.getBalance(fromAddress);
            if (balance < amountInSun) {
                throw new Error('Solde insuffisant');
            }

            // Créer et signer la transaction
            const transaction = await tempTronWeb.transactionBuilder.sendTrx(
                toAddress,
                amountInSun,
                fromAddress
            );

            const signedTransaction = await tempTronWeb.trx.sign(transaction);
            const result = await tempTronWeb.trx.sendRawTransaction(signedTransaction);

            if (result.result) {
                return {
                    success: true,
                    txid: result.txid,
                    transaction: signedTransaction
                };
            } else {
                throw new Error(result.message || 'Transaction échouée');
            }
        } catch (error) {
            console.error('Erreur envoi TRX:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Calculer les frais de transaction estimés
    async estimateTransactionFee(fromAddress, toAddress, amount) {
        try {
            const amountInSun = this.tronWeb.toSun(amount);
            const transaction = await this.tronWeb.transactionBuilder.sendTrx(
                toAddress,
                amountInSun,
                fromAddress
            );
            
            // Les frais de base pour un transfert TRX sont généralement de 1.1 TRX
            return 1.1;
        } catch (error) {
            console.error('Erreur estimation frais:', error);
            return 1.1; // Frais par défaut
        }
    }

    // Vérifier si une adresse est valide
    isValidAddress(address) {
        return this.tronWeb.isAddress(address);
    }

    // Convertir TRX en Sun
    toSun(trxAmount) {
        return this.tronWeb.toSun(trxAmount);
    }

    // Convertir Sun en TRX
    fromSun(sunAmount) {
        return this.tronWeb.fromSun(sunAmount);
    }
}

module.exports = TronService;