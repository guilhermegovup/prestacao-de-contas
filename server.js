const express = require('express');
const { google } = require('googleapis');
const multer = require('multer');
const path = require('path');
const session = require('express-session'); // Recomendo usar express-session em produção

const app = express();
const port = process.env.PORT || 3000; // Vercel usa a variável de ambiente PORT

// --- ATENÇÃO: NUNCA COLOQUE SUAS CHAVES DIRETAMENTE NO CÓDIGO ---
// Use as "Environment Variables" no painel da Vercel para isso.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;

// Define o domínio base. Em produção (Vercel), usa o domínio do app.
const aplicationDomain = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${port}`;

const REDIRECT_URI = `${aplicationDomain}/auth/google/callback`;

// Configuração do Cliente OAuth2
const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
);

const scopes = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.profile'
];

// Configuração de sessão para produção
app.use(session({
    secret: SESSION_SECRET || 'fallback_secret_for_local_dev', // Usa a variável de ambiente
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production' // Usa cookies seguros em produção
    }
}));


// Servir arquivos estáticos (CSS, JS, imagens) da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Rotas da API ---

// Rota de autenticação inicial
app.get('/auth/google', (req, res) => {
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent', // Força o reaparecimento da tela de consentimento
        scope: scopes
    });
    res.redirect(url);
});

// Rota de callback após autorização do Google
app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    try {
        const { tokens } = await oauth2Client.getToken(code);
        req.session.tokens = tokens; // Armazena os tokens na sessão
        res.redirect('/'); // Redireciona para a página principal
    } catch (error) {
        console.error('Erro ao obter tokens:', error);
        res.status(500).send('Falha na autenticação.');
    }
});

// Rota para verificar o status do login
app.get('/api/user', async (req, res) => {
    if (!req.session.tokens) {
        return res.status(401).json({ loggedIn: false });
    }
    oauth2Client.setCredentials(req.session.tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    try {
        const { data } = await oauth2.userinfo.get();
        res.json({ loggedIn: true, name: data.name });
    } catch (error) {
        delete req.session.tokens;
        res.status(401).json({ loggedIn: false });
    }
});

// Rota de Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ success: false, message: "Falha ao fazer logout." });
        }
        res.clearCookie('connect.sid'); // Limpa o cookie da sessão
        res.json({ success: true });
    });
});


// Rota para fazer upload (nenhuma mudança aqui)
const upload = multer({ storage: multer.memoryStorage() });
app.post('/api/submit-expense', upload.single('receipt'), async (req, res) => {
    // A lógica de upload permanece a mesma
    if (!req.session.tokens || !req.file) {
        return res.status(401).send('Não autorizado ou nenhum arquivo enviado.');
    }
    oauth2Client.setCredentials(req.session.tokens);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const { description, amount } = req.body;
    const file = req.file;

    try {
        // ... (resto da sua lógica de criação de pasta e upload)
        let folderId = null;
        const folderResponse = await drive.files.list({
            q: "mimeType='application/vnd.google-apps.folder' and name='Despesas da Empresa'",
            fields: 'files(id)',
        });

        if (folderResponse.data.files.length > 0) {
            folderId = folderResponse.data.files[0].id;
        } else {
            const folderMetadata = {
                name: 'Despesas da Empresa',
                mimeType: 'application/vnd.google-apps.folder',
            };
            const createdFolder = await drive.files.create({
                resource: folderMetadata,
                fields: 'id',
            });
            folderId = createdFolder.data.id;
        }

        const fileMetadata = {
            name: `[${new Date().toISOString().split('T')[0]}] ${description} - R$ ${amount}.pdf`,
            parents: [folderId]
        };
        const media = {
            mimeType: file.mimetype,
            body: require('stream').Readable.from(file.buffer),
        };

        const driveResponse = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id'
        });

        res.json({ success: true, message: 'Despesa e comprovante enviados com sucesso!', fileId: driveResponse.data.id });

    } catch (error) {
        console.error("Erro ao fazer upload para o Drive:", error);
        res.status(500).send('Erro ao enviar o arquivo para o Google Drive.');
    }
});

// Rota para a página inicial (deve vir por último)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// app.listen(port, () => {
//     console.log(`Servidor rodando na porta ${port}`);
// });

module.exports = app;