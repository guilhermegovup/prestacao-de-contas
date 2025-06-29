const express = require('express');
const { google } = require('googleapis');
const multer = require('multer');
const path = require('path');
const { createClient } = require('redis');
const RedisStore = require("connect-redis").default;
const session = require('express-session');

// Carrega as variáveis de ambiente do arquivo .env para process.env
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
const port = process.env.PORT || 3000;

// Carregar variáveis de ambiente do painel da Vercel
const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_DRIVE_FOLDER_ID,
    SESSION_SECRET,
    REDIS_URL // Adicione esta linha no seu .env e nas variáveis da Vercel
} = process.env;

// Validação das variáveis de ambiente. A aplicação não deve iniciar sem elas.
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !SESSION_SECRET || (process.env.NODE_ENV === 'production' && !REDIS_URL)) {
    console.error('ERRO FATAL: As variáveis de ambiente GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET (e REDIS_URL em produção) são obrigatórias.');
    console.error('Verifique seu arquivo .env (localmente) ou as configurações de Environment Variables (na Vercel).');
    process.exit(1); // Encerra a aplicação se as variáveis essenciais não estiverem definidas.
}

const scopes = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.profile'
];

// --- Helper Function para criar e configurar o cliente OAuth2 ---
// Centraliza a lógica para evitar repetição e garantir consistência.
function createOAuth2Client(req) {
    // Define o domínio base dinamicamente com base no host da requisição ou .env
    const currentApplicationDomain = process.env.APP_URL || (process.env.NODE_ENV === 'production' ? `https://${req.headers.host}` : `http://localhost:${port}`);
    const currentRedirectUri = `${currentApplicationDomain}/auth/google/callback`;

    const oauth2Client = new google.auth.OAuth2(
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        currentRedirectUri
    );

    return oauth2Client;
}

// --- Configuração do Armazenamento de Sessão ---
let sessionStore;

if (process.env.NODE_ENV === 'production') {
    // Em produção, usa o Redis para persistir a sessão.
    const redisClient = createClient({ url: REDIS_URL });
    redisClient.on('error', (err) => console.error('Erro no Cliente Redis:', err));
    redisClient.connect().catch(console.error);

    sessionStore = new RedisStore({
        client: redisClient,
        prefix: "prestacaodecontas:", // Prefixo opcional para as chaves no Redis
    });
}
// Em desenvolvimento, `sessionStore` será undefined, e `express-session` usará o MemoryStore padrão.

// Configurar o middleware de sessão (Isto deve vir ANTES das suas rotas)
// Garante que a aplicação irá gerir cookies e sessões de utilizador.
app.use(session({
    store: sessionStore,
    secret: SESSION_SECRET, // A validação acima garante que esta variável existe.
    resave: false,
    saveUninitialized: false, // Alterado para false: boa prática para sessões de login.
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
    const oauth2Client = createOAuth2Client(req);

    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: scopes
    });
    res.redirect(url);
});

// Rota de callback após autorização do Google
app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    const oauth2Client = createOAuth2Client(req);

    try {
        const { tokens } = await oauth2Client.getToken(code); // Obtém os tokens
        req.session.tokens = tokens;

        // Salva a sessão explicitamente antes de redirecionar.
        // Isso corrige o problema de a página recarregar no estado de "não logado"
        // por garantir que o token de sessão seja persistido antes da próxima requisição.
        req.session.save((err) => {
            if (err) {
                console.error('Erro ao salvar a sessão:', err);
                return res.status(500).send('Falha ao processar o login.');
            }
            res.redirect('/'); // Agora redireciona com segurança
        });
    } catch (error) {
        console.error('Erro na rota de callback:', error.message);
        res.status(500).send('Falha na autenticação ao processar o callback.');
    }
});

// Rota para verificar o status do login do utilizador
app.get('/api/user', async (req, res) => {
    // Verifica se os tokens existem na sessão
    if (req.session && req.session.tokens) {
        const oauth2Client = createOAuth2Client(req);
        oauth2Client.setCredentials(req.session.tokens);

        // Adiciona um listener para o evento 'tokens'.
        // Se o access_token for atualizado (usando o refresh_token),
        // este evento é disparado e nós atualizamos a sessão.
        oauth2Client.on('tokens', (tokens) => {
            if (tokens.refresh_token) {
                // Se um novo refresh_token for fornecido, armazene-o.
                req.session.tokens.refresh_token = tokens.refresh_token;
            }
            req.session.tokens.access_token = tokens.access_token;
            req.session.save(); // Salva a sessão atualizada
        });

        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        try {
            const { data } = await oauth2.userinfo.get();
            res.json({ loggedIn: true, name: data.name });
        } catch (error) {
            console.error('Erro ao buscar informações do usuário (token pode ter expirado):', error.message);
            // Limpa a sessão se o token for inválido/expirado
            req.session.destroy(() => {
                res.status(401).json({ loggedIn: false, error: 'Session expired' });
            });
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
        // Alterado para retornar JSON, que é o que o frontend espera.
        // Isso corrige o erro "Unexpected token 'N', 'Não autorizado.' is not valid JSON".
        // O erro ocorria porque o frontend sempre tenta analisar a resposta como JSON.
        return res.status(401).json({ success: false, message: 'Não autorizado. Faça o login novamente.' });
    }
    
    try {
        // 1. Acessar os dados do formulário
        const { description, amount } = req.body;
        // 2. Acessar o arquivo enviado (comprovante)
        const receiptFile = req.file; // req.file contém informações sobre o arquivo
        if (!receiptFile) {
            return res.status(400).json({ success: false, message: 'Nenhum comprovante foi enviado.' });
        }

        const oauth2Client = createOAuth2Client(req);
        oauth2Client.setCredentials(req.session.tokens);

        // Instanciar o serviço do Google Drive
        const drive = google.drive({ version: 'v3', auth: oauth2Client });

        // Preparar metadados do arquivo para o Google Drive
        const fileExtension = receiptFile.originalname.split('.').pop();
        // Nome do arquivo mais descritivo no Google Drive
        const fileName = `${description} - R$ ${parseFloat(amount).toFixed(2)} - ${new Date().toISOString().slice(0, 10)}.${fileExtension}`;
        
        // Verificação para garantir que o ID da pasta foi alterado.
        // Isso evita erros da API do Google e fornece uma mensagem mais clara.
        if (!GOOGLE_DRIVE_FOLDER_ID) {
            const errorMessage = 'Configuração do servidor incompleta: O ID da pasta do Google Drive precisa ser definido.';
            console.error(`ERRO: ${errorMessage}`);
            return res.status(500).json({ success: false, message: errorMessage });
        }

        const fileMetadata = {
            name: fileName,
            parents: [GOOGLE_DRIVE_FOLDER_ID],
        };

        const media = {
            mimeType: receiptFile.mimetype,
            body: require('stream').Readable.from(receiptFile.buffer), // Converte o buffer do Multer em stream
        };

        // Realizar o upload do arquivo para o Google Drive
        const uploadedFile = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id,name,webViewLink', // Solicita o ID, nome e link de visualização do arquivo
        });

        console.log('Arquivo enviado para o Drive. ID:', uploadedFile.data.id);
        console.log('Link de visualização:', uploadedFile.data.webViewLink);

        res.json({
            success: true,
            message: 'Despesa e comprovante enviados com sucesso para o seu Google Drive!',
            fileId: uploadedFile.data.id,
            fileLink: uploadedFile.data.webViewLink // Envia o link de volta para o frontend
        });
    } catch (error) {
        console.error('Erro ao processar o envio da despesa:', error);
        // Enviar resposta de erro para o cliente
        res.status(500).json({ success: false, message: 'Erro interno do servidor ao processar a despesa.' });
    }
});

// Rota para a página inicial (deve vir por último)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
    console.log(`Servidor a rodar na porta ${port}`);
});
