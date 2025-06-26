const express = require('express');
const { google } = require('googleapis');
const multer = require('multer');
const path = require('path');
const session = require('express-session');

const app = express();
const port = process.env.PORT || 3000;

// Carregar variáveis de ambiente do painel da Vercel
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET; // Esta é a sua senha secreta para a sessão

const scopes = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.profile'
];

// Configurar o middleware de sessão (Isto deve vir ANTES das suas rotas)
// Garante que a aplicação irá gerir cookies e sessões de utilizador.
app.use(session({
    secret: SESSION_SECRET || 'uma-senha-secreta-para-desenvolvimento-local', // Use a variável de ambiente em produção
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Em produção (Vercel), os cookies devem ser seguros
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // Expira em 24 horas
    }
}));

// Servir arquivos estáticos (CSS, JS) da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Rotas da API ---

// Rota de autenticação inicial
app.get('/auth/google', (req, res) => {
    // Define o domínio base dinamicamente com base no host da requisição
    const currentApplicationDomain = process.env.APP_URL || (process.env.NODE_ENV === 'production' ? `https://${req.headers.host}` : `http://localhost:${port}`);
    const currentRedirectUri = `${currentApplicationDomain}/auth/google/callback`;

    // Configura o cliente OAuth2 com a URI de redirecionamento dinâmica
    const oauth2Client = new google.auth.OAuth2(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        currentRedirectUri
    );

    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: scopes
    });
    console.log('REDIRECT_URI dinâmico:', currentRedirectUri); // Log do REDIRECT_URI dinâmico
    res.redirect(url);
});

// Rota de callback após autorização do Google
app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;

    // Define o domínio base dinamicamente com base no host da requisição
    const currentApplicationDomain = process.env.APP_URL || (process.env.NODE_ENV === 'production' ? `https://${req.headers.host}` : `http://localhost:${port}`);
    const currentRedirectUri = `${currentApplicationDomain}/auth/google/callback`;

    // Configura o cliente OAuth2 com a URI de redirecionamento dinâmica
    const oauth2Client = new google.auth.OAuth2(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        currentRedirectUri
    );

    try {
        const { tokens } = await oauth2Client.getToken(code);
        // Armazenar os tokens na sessão do utilizador
        req.session.tokens = tokens;
        res.redirect('/'); // Redireciona para a página principal após o login
    } catch (error) {
        console.error('Erro na rota de callback:', error.message);
        res.status(500).send('Falha na autenticação ao processar o callback.');
    }
});

// Rota para verificar o status do login do utilizador
app.get('/api/user', async (req, res) => {
    // Verifica se os tokens existem na sessão
    if (req.session && req.session.tokens) {
        // Re-instanciar oauth2Client com a REDIRECT_URI correta antes de setar as credenciais
        const currentApplicationDomain = process.env.APP_URL || (process.env.NODE_ENV === 'production' ? `https://${req.headers.host}` : `http://localhost:${port}`);
        const currentRedirectUri = `${currentApplicationDomain}/auth/google/callback`;

        const oauth2Client = new google.auth.OAuth2(
            GOOGLE_CLIENT_ID,
            GOOGLE_CLIENT_SECRET,
            currentRedirectUri
        );

        oauth2Client.setCredentials(req.session.tokens);
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        try {
            const { data } = await oauth2.userinfo.get();
            res.json({ loggedIn: true, name: data.name });
        } catch (error) {
            // Se o token expirou, limpa a sessão
            req.session.destroy();
            res.status(401).json({ loggedIn: false });
        }
    } else {
        res.status(401).json({ loggedIn: false });
    }
});

// Rota de Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ success: false, message: "Falha ao fazer logout." });
        }
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// O resto do seu código (upload, etc.) permanece o mesmo...
const upload = multer({ storage: multer.memoryStorage() });
app.post('/api/submit-expense', upload.single('receipt'), async (req, res) => {
    if (!req.session.tokens) {
        return res.status(401).send('Não autorizado.');
    }
    // ... o resto da sua lógica de upload
});

// Rota para a página inicial (deve vir por último)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Servidor a rodar na porta ${port}`);
});
