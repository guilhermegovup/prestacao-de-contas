// prestacao-de-contas/server.js
// ...
require('dotenv').config(); // Adicione esta linha no topo

// ...

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

// ...

app.use(session({
    secret: process.env.SESSION_SECRET, // Use a variável de ambiente
    resave: false,
    saveUninitialized: true,
}));
// ...
