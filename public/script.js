document.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('login-btn');
    const appContainer = document.getElementById('app-container');
    const loginPrompt = document.getElementById('login-prompt');
    const userInfo = document.getElementById('user-info');
    const userName = document.getElementById('user-name');
    const expenseForm = document.getElementById('expense-form');
    const statusMessage = document.getElementById('status-message');

    // 1. Verifica o status do login ao carregar a página
    async function checkLoginStatus() {
        try {
            const response = await fetch('/api/user');
            if (response.ok) {
                const user = await response.json();
                showApp(user.name);
            } else {
                showLogin();
            }
        } catch (error) {
            showLogin();
        }
    }

    function showApp(name) {
        loginPrompt.classList.add('hidden');
        appContainer.classList.remove('hidden');
        loginBtn.classList.add('hidden');
        userInfo.classList.remove('hidden');
        userName.textContent = `Bem-vindo, ${name}!`;
    }

    function showLogin() {
        loginPrompt.classList.remove('hidden');
        appContainer.classList.add('hidden');
        loginBtn.classList.remove('hidden');
        userInfo.classList.add('hidden');
    }

    // 2. Event Listener para o botão de login
    loginBtn.addEventListener('click', () => {
        window.location.href = '/auth/google';
    });

    // 3. Event Listener para o envio do formulário
    expenseForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        
        const formData = new FormData(expenseForm);
        const submitBtn = document.getElementById('submit-btn');
        
        statusMessage.textContent = 'Enviando...';
        statusMessage.className = 'status-message';
        submitBtn.disabled = true;

        try {
            const response = await fetch('/api/submit-expense', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();

            if (response.ok && result.success) {
                statusMessage.textContent = 'Despesa enviada com sucesso para o seu Google Drive!';
                statusMessage.classList.add('success');
                expenseForm.reset();
            } else {
                throw new Error(result.message || 'Ocorreu um erro.');
            }

        } catch (error) {
            statusMessage.textContent = `Erro ao enviar: ${error.message}`;
            statusMessage.classList.add('error');
        } finally {
            submitBtn.disabled = false;
        }
    });

    // Inicia a verificação de login
    checkLoginStatus();
});