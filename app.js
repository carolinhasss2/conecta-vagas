const PROFILE_KEY = "conecta_vagas_profile";
const AUTH_KEY = "conecta_vagas_auth";
const INTERESTS_KEY = "conecta_vagas_interests";
const INTERESTS_TABLE = "job_interests";
const AVATARS_BUCKET = "avatars";
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const SUPABASE_URL = "https://qfzimqlnxqpesvcedlnn.supabase.co";
const SUPABASE_KEY = "sb_publishable_n4K9bEKr4PvJmA6miP7M1Q_7an5HNT-";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);
let jobs = [];
let interestCounts = {};
let currentDatabaseProfile = null;
let jobFilter = "all";

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatDateBR(value) {
    const date = String(value ?? "");
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : date;
}

function safePhotoUrl(value) {
    const photo = String(value ?? "");
    return photo.startsWith("https://") || photo.startsWith("data:image/")
        ? escapeHtml(photo)
        : "";
}

async function getPhotoUrl(photoPath) {
    const path = String(photoPath ?? "");

    if (!path || path.startsWith("data:image/")) {
        return "";
    }

    if (path.startsWith("https://")) {
        return safePhotoUrl(path);
    }

    const { data, error } = await supabaseClient.storage
        .from(AVATARS_BUCKET)
        .createSignedUrl(path, 300);

    if (error) {
        console.error("Não foi possível gerar a URL da foto:", error);
        return "";
    }

    return safePhotoUrl(data?.signedUrl);
}

function resizeAvatar(file) {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

    if (!allowedTypes.includes(file.type)) {
        return Promise.reject(new Error("A foto deve ser JPEG, PNG ou WebP."));
    }

    if (file.size > MAX_AVATAR_SIZE) {
        return Promise.reject(new Error("A foto deve ter no máximo 2 MB."));
    }

    return new Promise((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);

        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const scale = Math.min(1, 400 / Math.max(image.width, image.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);

            canvas.toBlob(blob => {
                if (!blob || blob.size > MAX_AVATAR_SIZE) {
                    reject(new Error("Não foi possível preparar uma foto de até 2 MB."));
                    return;
                }

                resolve(blob);
            }, file.type, 0.86);
        };

        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("Não foi possível ler a imagem selecionada."));
        };

        image.src = objectUrl;
    });
}

async function uploadAvatar(file, userId) {
    const blob = await resizeAvatar(file);
    const extensionByType = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp"
    };
    const path = `${userId}/avatar.${extensionByType[file.type]}`;

    const { error } = await supabaseClient.storage
        .from(AVATARS_BUCKET)
        .upload(path, blob, {
            cacheControl: "3600",
            contentType: file.type,
            upsert: true
        });

    if (error) {
        throw error;
    }

    return path;
}

function safeInlineId(value) {
    const id = String(value ?? "");
    if (/^\d+$/.test(id) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        return `'${id}'`;
    }
    return "null";
}

function getWhatsappUrl(phone) {
    const digits = String(phone ?? "").replace(/\D/g, "");
    if (!digits) return "";
    const international = digits.startsWith("55") ? digits : `55${digits}`;
    return `https://wa.me/${international}`;
}

const app = document.getElementById("app");

function getAuth() {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
}

function getProfile() {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null");
}

function getInterests() {
    return JSON.parse(localStorage.getItem(INTERESTS_KEY) || "[]");
}

let toastTimer;

function showToast(message, type = "info") {
    let toast = document.getElementById("app-toast");

    if (!toast) {
        toast = document.createElement("div");
        toast.id = "app-toast";
        toast.style.position = "fixed";
        toast.style.right = "20px";
        toast.style.bottom = "20px";
        toast.style.zIndex = "10";
        toast.style.maxWidth = "min(420px, calc(100vw - 40px))";
        document.body.appendChild(toast);
    }

    toast.className = `notice ${type === "error" ? "danger" : ""}`;
    toast.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.remove(), 5000);
}

function publicJobs() {
    const today = new Date().toISOString().slice(0, 10);
    return jobs.filter(job =>
        (job.status || "open") === "open" && String(job.date) >= today
    );
}

function isJobPast(job) {
    const today = new Date().toISOString().slice(0, 10);
    return String(job?.date ?? "") < today;
}

function filteredJobs() {
    const today = new Date().toISOString().slice(0, 10);

    if (jobFilter === "all") {
        return jobs;
    }

    if (jobFilter === "closed") {
        return jobs.filter(job => job.status === "closed");
    }

    if (jobFilter === "past") {
        return jobs.filter(job =>
            (job.status || "open") === "open" && String(job.date) < today
        );
    }

    return publicJobs();
}

function setJobFilter(filter) {
    jobFilter = filter;
    render();
}

async function loadInterests() {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData.session?.user;

    if (!user) {
        localStorage.removeItem(INTERESTS_KEY);
        return [];
    }

    const { data, error } = await supabaseClient
        .from(INTERESTS_TABLE)
        .select("id, user_id, job_id, created_at")
        .eq("user_id", user.id);

    if (error) {
        console.error("Não foi possível carregar os interesses:", error);
        return [];
    }

    const interests = data || [];
    localStorage.setItem(INTERESTS_KEY, JSON.stringify(interests));
    return interests;
}

async function loadInterestCounts() {
    const { data, error } = await supabaseClient.rpc("get_job_interest_counts");
    if (error) {
        console.error("Não foi possível carregar a lotação das vagas:", error);
        interestCounts = {};
        return;
    }

    interestCounts = data || {};
}

function cacheProfile(profile) {
    if (profile?.role === "worker") {
        localStorage.setItem(PROFILE_KEY, JSON.stringify({
            ...profile,
            photo: profile.photo_url || profile.photo || ""
        }));
    }
}

async function fetchWorkerProfile(userId) {
    const { data, error } = await supabaseClient
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

    if (error) {
        console.error("Não foi possível carregar o perfil:", error);
        return { profile: null, error };
    }

    if (data?.role === "worker") {
        cacheProfile(data);
    }

    return { profile: data, error: null };
}

async function syncAuthState() {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const session = sessionData.session;

    if (!session?.user) {
        currentDatabaseProfile = null;
        localStorage.removeItem(AUTH_KEY);
        localStorage.removeItem(PROFILE_KEY);
        return null;
    }

    const { profile: databaseProfile, error } = await fetchWorkerProfile(
        session.user.id
    );

    if (error) {
        currentDatabaseProfile = null;
        return session;
    }

    currentDatabaseProfile = databaseProfile;

    localStorage.setItem(AUTH_KEY, JSON.stringify({
        role: databaseProfile?.role || "worker",
        approved: databaseProfile?.approved === true,
        email: session.user.email,
        userId: session.user.id
    }));

    if (!databaseProfile || databaseProfile.role !== "worker") {
        localStorage.removeItem(PROFILE_KEY);
    }

    return session;
}

function buildDatabaseProfile(profile, userId, photo) {
    return {
        id: userId,
        role: "worker",
        name: profile.name,
        phone: profile.phone || null,
        email: profile.email,
        sex: profile.sex || null,
        gender: profile.gender || null,
        birth: profile.birth || null,
        city: profile.city || null,
        address: profile.address || null,
        height: profile.height || null,
        weight: profile.weight || null,
        shirt: profile.shirt || null,
        pants: profile.pants || null,
        shoe: profile.shoe || null,
        car: profile.car,
        drive: profile.drive,
        license: profile.license,
        education: profile.education || null,
        experience: profile.experience || null,
        availability: profile.availability || null,
        photo_url: photo || null
    };
}

async function saveWorkerProfile(profile, userId, photo) {
    return supabaseClient
        .from("profiles")
        .upsert(buildDatabaseProfile(profile, userId, photo));
}

async function loadJobs() {
    await syncAuthState();
    await loadInterests();
    await loadInterestCounts();

    const { data, error } = await supabaseClient
        .from("jobs")
        .select("*")
        .order("date", { ascending: true });

    if (error) {
        console.error("Erro ao carregar vagas:", error);
        app.innerHTML = layout(
            "Vagas disponíveis",
            `<div class="card empty">Não foi possível carregar as vagas.</div>`
        );
        return;
    }

    jobs = data || [];
    render();
}

function getAuthErrorMessage(error) {
    if (error?.message?.toLowerCase().includes("rate limit")) {
        return "O limite de envio de e-mails foi atingido. Aguarde um pouco antes de tentar novamente.";
    }

    return error?.message || "Não foi possível concluir a autenticação.";
}

function go(page, id = "", subId = "") {
    const destination = subId
        ? `${page}/${id}/${subId}`
        : id
            ? `${page}/${id}`
            : page;

    if (window.location.hash.slice(1) === destination) {
        render();
        return;
    }

    try {
        window.history.pushState(null, "", `#${destination}`);
    } catch (navigationError) {
        window.location.hash = `#${destination}`;
    }

    render();
}

async function logout() {
    const { error } = await supabaseClient.auth.signOut();

    if (error) {
        showToast("Não foi possível sair: " + error.message, "error");
        console.error(error);
        return;
    }

    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(INTERESTS_KEY);
    currentDatabaseProfile = null;
    window.location.hash = "#acesso";
    render();
}

function nav() {
    const auth = getAuth();
    const page = location.hash.slice(1).split("/")[0] || "acesso";
    const profile = getProfile();
    const hasWorkerProfile =
        auth?.role === "worker" &&
        auth.userId &&
        profile?.id === auth.userId;

    if (!auth || page === "inicio" || page === "acesso") {
        document.getElementById("nav").innerHTML = "";
        return;
    }

    const links = [
        ["inicio", "Início"],
        ["vagas", "Vagas"],
        ["cadastro", "Criar cadastro"],
        ["privacidade", "Privacidade"]
    ];

    if (hasWorkerProfile) {
        links[2][1] = "Meu cadastro";
        links.push(["perfil", "Meu perfil"]);
    }

    if (currentDatabaseProfile?.role === "recruiter") {
        links.push(["gerenciar-vagas", "Minhas vagas"]);
    }

    document.getElementById("nav").innerHTML = links.map(([id, text]) =>
        `<button onclick="go('${id}')">${text}</button>`
    ).join("") + `<button onclick="logout()">Sair</button>`;
}

function layout(title, body) {
    return `
        <div class="section-title">
            <h2>${title}</h2>
        </div>
        ${body}
    `;
}

function hasInterest(jobId) {
    return getInterests().some(item =>
        String(item.job_id ?? item.jobId) === String(jobId)
    );
}

function jobCard(job) {
    const joined = hasInterest(job.id);
    const jobId = safeInlineId(job.id);
    const interestCount = Number(interestCounts[String(job.id)] || 0);
    const isFilled = interestCount >= Number(job.people);
    const isPast = isJobPast(job);
    const canWithdraw = joined;
    const actionLabel = joined
        ? "Retirar interesse"
        : isPast
            ? "Prazo encerrado"
            : "POSSO PARTICIPAR";

    return `
        <article class="card job-card">
            <span class="tag">${escapeHtml(job.city)}</span>
            ${isFilled ? '<span class="tag">Vagas preenchidas</span>' : ""}
            <h3>${escapeHtml(job.title)}</h3>
            <b>${escapeHtml(job.company)}</b>

            <div class="job-meta">
                <div>Data: ${escapeHtml(formatDateBR(job.date))} · ${escapeHtml(job.time)}</div>
                <div>Local: ${escapeHtml(job.place)}</div>
                <div>Pagamento: <b>${escapeHtml(job.value)}</b></div>
                <div>${escapeHtml(job.people)} profissionais necessários (${escapeHtml(interestCount)} interessados)</div>
            </div>

            <button class="${canWithdraw ? "secondary" : "primary"}"
                ${canWithdraw || !isPast ? "" : "disabled"}
                onclick="${canWithdraw ? `withdrawInterest(${jobId})` : `join(${jobId})`}">
                ${actionLabel}
            </button>

            <button class="secondary" style="margin-top:8px"
                onclick="go('detalhe', ${jobId})">
                Ver detalhes
            </button>
        </article>
    `;
}

function render() {
    nav();

    const hash = location.hash.slice(1) || "acesso";
    const parts = hash.split("/");
    const page = parts[0];
    const id = parts[1];

    if (page === "inicio") {
        showAccess();
    } else if (page === "vagas") {
        app.innerHTML = layout(
            "Vagas disponíveis",
            `
                <p class="muted">
                    Encontre oportunidades e demonstre seu interesse sem preencher seus dados novamente.
                </p>

                <div class="actions job-filters" aria-label="Filtrar vagas">
                    <button class="${jobFilter === "all" ? "primary" : "secondary"}"
                        onclick="setJobFilter('all')">Todas</button>
                    <button class="${jobFilter === "active" ? "primary" : "secondary"}"
                        onclick="setJobFilter('active')">Ativas</button>
                    <button class="${jobFilter === "closed" ? "primary" : "secondary"}"
                        onclick="setJobFilter('closed')">Encerradas</button>
                    <button class="${jobFilter === "past" ? "primary" : "secondary"}"
                        onclick="setJobFilter('past')">Atrasadas</button>
                </div>

                <div class="grid">
                    ${filteredJobs().length
                        ? filteredJobs().map(jobCard).join("")
                        : `<div class="card empty">Nenhuma vaga encontrada neste filtro.</div>`}
                </div>
            `
        );
    } else if (page === "detalhe") {
        showJobDetails(id);
    } else if (page === "cadastro") {
        showForm();
    } else if (page === "privacidade") {
        showPrivacy();
    } else if (page === "perfil") {
        showProfile();
        } else if (page === "acesso") {
    showAccess();
        } else if (page === "gerenciar-vagas") {
            showRecruiterDashboard();
    } else if (page === "interessados") {
        showInterested(id);
    } else if (page === "interessado") {
        showInterestedProfile(parts[1], parts[2]);
    } else {
        go("inicio");
    }
}

function showJobDetails(jobId) {
    const job = jobs.find(item => String(item.id) === String(jobId));

    if (!job) {
        app.innerHTML = layout("Vaga não encontrada",
            `<div class="card empty">Esta vaga não existe.</div>`
        );
        return;
    }

    const joined = hasInterest(job.id);
    const isPast = isJobPast(job);
    const canWithdraw = joined;
    const actionLabel = joined
        ? "Retirar interesse"
        : isPast
            ? "Prazo encerrado"
            : "POSSO PARTICIPAR";

    app.innerHTML = layout(
        "Detalhes da vaga",
        `
            <article class="card">
                <span class="tag">${escapeHtml(job.city)}</span>
                <h2>${escapeHtml(job.title)}</h2>
                <p><b>${escapeHtml(job.company)}</b> · ${escapeHtml(formatDateBR(job.date))} · ${escapeHtml(job.time)}</p>
                <hr>

                <p><b>Local:</b> ${escapeHtml(job.place)}</p>
                <p><b>Pagamento:</b> ${escapeHtml(job.value)}</p>
                <p><b>Descrição:</b> ${escapeHtml(job.description)}</p>
                <p><b>Requisitos:</b> ${escapeHtml(job.requirements)}</p>
                <p><b>Informações adicionais:</b> ${escapeHtml(job.extra)}</p>

                <button class="${canWithdraw ? "secondary" : "primary"}"
                    ${canWithdraw || !isPast ? "" : "disabled"}
                    onclick="${canWithdraw ? `withdrawInterest(${safeInlineId(job.id)})` : `join(${safeInlineId(job.id)})`}">
                    ${actionLabel}
                </button>
            </article>
        `
    );
}

function showForm() {
    const profile = getProfile() || {};
    const auth = getAuth();
    const isEditing = currentDatabaseProfile?.role === "worker" ||
        (auth?.role === "worker" && auth.userId && profile.id === auth.userId);

    app.innerHTML = layout(
        "Meu cadastro",
        `
            <form class="form-card" onsubmit="saveProfile(event)">
                <div class="notice">
                    Seus dados ficam salvos neste navegador para facilitar
                    suas próximas candidaturas.
                </div>

                <div class="form-grid">
                    ${[
                        ["name", "Nome completo", "text"],
                        ["phone", "Telefone", "tel"],
                        ["email", "E-mail", "email"],
                        ["birth", "Data de nascimento", "date"],
                        ["city", "Cidade", "text"],
                        ["address", "Endereço", "text"],
                        ["height", "Altura", "text"],
                        ["weight", "Peso", "text"],
                        ["shirt", "Número da camisa", "text"],
                        ["pants", "Número da calça", "text"],
                        ["shoe", "Número do tênis", "text"],
                        ["photoFile", "Foto de perfil", "file"]
                    ].map(([name, label, type]) => `
                        <div class="field">
                            <label>${label}</label>
                           <input name="${name}" type="${type}"
    ${type !== "file" ? `value="${escapeHtml(profile[name])}"` : ""}
    ${type === "file" ? 'accept="image/jpeg,image/png,image/webp"' : ""}
    ${["name", "email"].includes(name) ? "required" : ""}>
                        </div>
                    `).join("")}
                    ${!isEditing ? `
                        <label class="check full">
                            <input type="checkbox" name="privacyConsent" required>
                            Li e aceito a <a href="#privacidade" target="_blank">Política de Privacidade</a>.
                        </label>
                    ` : ""}
                    <div class="field">
    <label>Senha de acesso</label>
    <input
        name="password"
        type="password"
        minlength="8"
        ${isEditing ? "" : "required"}
        placeholder="${isEditing ? "Deixe em branco para manter a atual" : "Mínimo de 8 caracteres"}">
</div>

                    <div class="field">
                        <label>Sexo</label>
                        <select name="sex">
                            <option value="">Não informado</option>
                            <option ${profile.sex === "Feminino" ? "selected" : ""}>Feminino</option>
                            <option ${profile.sex === "Masculino" ? "selected" : ""}>Masculino</option>
                            <option ${profile.sex === "Prefiro não informar" ? "selected" : ""}>
                                Prefiro não informar
                            </option>
                        </select>
                    </div>

                    <div class="field">
                        <label>Gênero</label>
                        <input name="gender" value="${escapeHtml(profile.gender)}">
                    </div>

                    <div class="field">
                        <label>Escolaridade</label>
                        <input name="education" value="${escapeHtml(profile.education)}">
                    </div>

                    <div class="field">
                        <label>Disponibilidade</label>
                        <input name="availability" value="${escapeHtml(profile.availability)}">
                    </div>

                    ${[
                        ["car", "Possui carro"],
                        ["drive", "Sabe dirigir"],
                        ["license", "Possui CNH"]
                    ].map(([name, label]) => `
                        <label class="check">
                            <input type="checkbox" name="${name}"
                                ${profile[name] ? "checked" : ""}>
                            ${label}
                        </label>
                    `).join("")}

                    <div class="field full">
                        <label>Experiência profissional</label>
                        <textarea name="experience">${escapeHtml(profile.experience)}</textarea>
                    </div>
                </div>

                <button class="primary" style="margin-top:20px">
                    Salvar meu perfil
                </button>
            </form>
        `
    );
}
async function saveProfile(event) {
    event.preventDefault();

    const form = event.target;
    const password = form.elements.password.value;
    const profile = Object.fromEntries(new FormData(form));
    const photoFile = form.elements.photoFile.files[0];
    const privacyConsent = form.elements.privacyConsent?.checked === true;

    delete profile.password;
    delete profile.photoFile;

    ["car", "drive", "license"].forEach(name => {
        profile[name] = form.elements[name].checked;
    });

    const oldProfile = getProfile();
    let photo = oldProfile?.photo_url || oldProfile?.photo || "";
    if (photo.startsWith("data:image/")) {
        photo = "";
    }

    const { data: sessionData } = await supabaseClient.auth.getSession();
    const sessionUser = sessionData.session?.user;
    const { profile: sessionProfile, error: sessionProfileError } = sessionUser
        ? await fetchWorkerProfile(sessionUser.id)
        : { profile: null, error: null };
    const isEditingCurrentProfile = Boolean(
        sessionUser &&
        !sessionProfileError &&
        sessionProfile?.role === "worker"
    );
    let data;
    let error;

    if (isEditingCurrentProfile) {
        const result = password
            ? await supabaseClient.auth.updateUser({ password })
            : { error: null };
        data = { user: sessionUser, session: sessionData.session };
        error = result.error;
    } else {
        if (sessionUser) {
            showToast("Sua sessão não possui um perfil de trabalhador válido para edição.", "error");
            return;
        }

        if (!password) {
            showToast("Informe uma senha para criar seu cadastro.", "error");
            return;
        }

        if (!privacyConsent) {
            showToast("Aceite a Política de Privacidade para criar o cadastro.", "error");
            return;
        }

        const result = await supabaseClient.auth.signUp({
            email: profile.email,
            password,
            options: {
                data: {
                    role: "worker",
                    ...profile
                }
            }
        });
        data = result.data;
        error = result.error;
    }

    if (error) {
        showToast(`${isEditingCurrentProfile ? "Não foi possível atualizar sua senha" : "Erro ao criar usuário"}: ${getAuthErrorMessage(error)}`, "error");
        console.error(error);
        return;
    }

    if (!data?.session || !data.user) {
        showToast("Usuário criado, mas a sessão não foi iniciada. Verifique se a confirmação de e-mail está desativada no Supabase.", "error");
        return;
    }

    if (photoFile) {
        try {
            photo = await uploadAvatar(photoFile, data.user.id);
        } catch (uploadError) {
            showToast("Não foi possível salvar a foto: " + uploadError.message, "error");
            console.error(uploadError);
            return;
        }
    }

    const { error: profileError } = await saveWorkerProfile(
        profile,
        data.user.id,
        photo
    );

    if (profileError) {
        showToast("Não foi possível salvar o perfil: " + profileError.message, "error");
        console.error(profileError);
        return;
    }

    profile.id = data.user.id;
    profile.photo = photo;

    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    localStorage.setItem(AUTH_KEY, JSON.stringify({
        role: "worker",
        email: profile.email,
        userId: data.user.id
    }));

    showToast(isEditingCurrentProfile
        ? "Perfil atualizado com sucesso."
        : "Cadastro criado com sucesso.");
    go("perfil");
}

function showAccess() {
    app.innerHTML = layout(
        "Acessar a plataforma",
        `
        <div class="grid">
            <div class="form-card">
                <h3>Acesso do trabalhador</h3>
                <p class="muted">
                    Entre para visualizar vagas e demonstrar interesse.
                </p>

                <form onsubmit="workerLogin(event)">
                    <div class="field">
                        <label>E-mail</label>
                        <input name="email" type="email" required>
                    </div>

                    <div class="field" style="margin-top:12px">
                        <label>Senha</label>
                        <input name="password" type="password" required>
                    </div>

                    <button class="primary" style="margin-top:16px">
                        Entrar como trabalhador
                    </button>
                </form>

                <button class="secondary"
                    onclick="go('cadastro')"
                    style="margin-top:10px">
                    Criar cadastro de trabalhador
                </button>
            </div>

            <div class="form-card">
                <h3>Acesso do recrutador</h3>
                <p class="muted">
                    Entre para visualizar os interessados nas vagas.
                </p>

                <form onsubmit="recruiterLogin(event)">
                    <div class="field">
                        <label>E-mail</label>
                        <input name="email" type="email" required>
                    </div>

                    <div class="field" style="margin-top:12px">
                        <label>Senha</label>
                        <input name="password" type="password" required>
                    </div>

                    <button class="primary" style="margin-top:16px">
                        Entrar como recrutador
                    </button>
                </form>

                <button class="secondary"
                    onclick="showRecruiterSignup()"
                    style="margin-top:10px">
                    Criar acesso de recrutador
                </button>
            </div>
        </div>

        <div class="actions" style="justify-content:center;margin-top:24px">
            <button class="secondary" onclick="go('vagas')">
                Ver vagas disponíveis
            </button>
        </div>
        `
    );
}

async function showRecruiterDashboard() {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData.session?.user;
    const { profile, error } = user
        ? await fetchWorkerProfile(user.id)
        : { profile: null, error: null };

    if (error || !user || profile?.role !== "recruiter") {
        showToast("Entre como recrutador para gerenciar vagas.", "error");
        go("acesso");
        return;
    }

    localStorage.setItem(AUTH_KEY, JSON.stringify({
        role: "recruiter",
        approved: profile.approved === true,
        email: user.email,
        userId: user.id
    }));
    currentDatabaseProfile = profile;

    if (profile.approved !== true) {
        app.innerHTML = layout(
            "Cadastro em análise",
            `<div class="card empty">Seu cadastro de recrutador está em análise. Você poderá publicar vagas após a aprovação.</div>`
        );
        return;
    }

    const ownJobs = jobs.filter(job => job.recruiter_id === user.id);

    app.innerHTML = layout(
        "Painel da empresa",
        `
            <div class="actions">
                <button class="primary" onclick="showJobForm()">Publicar nova vaga</button>
            </div>
            <div class="grid dashboard-grid" style="margin-top:18px">
                ${ownJobs.length ? ownJobs.map(job => `
                    <article class="card job-card">
                        <span class="tag">${escapeHtml(job.city)}</span>
                        <h3>${escapeHtml(job.title)}</h3>
                        <b>${escapeHtml(job.company)}</b>
                        <div class="job-meta">
                            <div>Data: ${escapeHtml(formatDateBR(job.date))} · ${escapeHtml(job.time)}</div>
                            <div>Local: ${escapeHtml(job.place)}</div>
                            <div>${escapeHtml(job.people)} profissionais necessários</div>
                        </div>
                        <div class="job-actions">
                            <button class="secondary" onclick="go('interessados', ${safeInlineId(job.id)})">
                                Ver interessados
                            </button>
                            <button class="secondary" onclick="showJobForm(${safeInlineId(job.id)})">
                                Editar vaga
                            </button>
                            <button class="secondary" onclick="requestJobAction('close', ${safeInlineId(job.id)})">
                                ${job.status === "closed" ? "Reabrir vaga" : "Encerrar vaga"}
                            </button>
                            <button class="danger" onclick="requestJobAction('delete', ${safeInlineId(job.id)})">
                                Apagar vaga
                            </button>
                        </div>
                    </article>
                `).join("") :
                    `<div class="card empty">Você ainda não publicou nenhuma vaga.</div>`}
            </div>
        `
    );
}

function showJobForm(jobId = "") {
    const job = jobs.find(item => String(item.id) === String(jobId));
    const editing = Boolean(job);

    app.innerHTML = layout(
        editing ? "Editar vaga" : "Publicar vaga",
        `
            <form class="form-card" onsubmit="saveJob(event)">
                <input type="hidden" name="id" value="${escapeHtml(job?.id || "")}">
                <div class="form-grid">
                    <div class="field">
                        <label>Título da vaga</label>
                        <input name="title" value="${escapeHtml(job?.title)}" required>
                    </div>
                    <div class="field">
                        <label>Empresa</label>
                        <input name="company" value="${escapeHtml(job?.company)}" required>
                    </div>
                    <div class="field">
                        <label>Data</label>
                        <input name="date" type="date" value="${escapeHtml(job?.date)}" required>
                    </div>
                    <div class="field">
                        <label>Horário</label>
                        <input name="time" value="${escapeHtml(job?.time)}" placeholder="09:00 às 18:00" required>
                    </div>
                    <div class="field">
                        <label>Cidade</label>
                        <input name="city" value="${escapeHtml(job?.city)}" required>
                    </div>
                    <div class="field">
                        <label>Local</label>
                        <input name="place" value="${escapeHtml(job?.place)}" required>
                    </div>
                    <div class="field">
                        <label>Profissionais necessários</label>
                        <input name="people" type="number" min="1" value="${escapeHtml(job?.people)}" required>
                    </div>
                    <div class="field">
                        <label>Pagamento</label>
                        <input name="value" value="${escapeHtml(job?.value)}" placeholder="R$ 180,00" required>
                    </div>
                    <div class="field full">
                        <label>Descrição</label>
                        <textarea name="description" required>${escapeHtml(job?.description)}</textarea>
                    </div>
                    <div class="field full">
                        <label>Requisitos</label>
                        <textarea name="requirements">${escapeHtml(job?.requirements)}</textarea>
                    </div>
                    <div class="field full">
                        <label>Informações adicionais</label>
                        <textarea name="extra">${escapeHtml(job?.extra)}</textarea>
                    </div>
                </div>
                <button class="primary" style="margin-top:20px">${editing ? "Salvar alterações" : "Publicar vaga"}</button>
            </form>
        `
    );
}

async function saveJob(event) {
    event.preventDefault();

    if (currentDatabaseProfile?.role !== "recruiter" ||
        currentDatabaseProfile.approved !== true) {
        showToast("Seu cadastro de recrutador ainda não foi aprovado.", "error");
        go("gerenciar-vagas");
        return;
    }

    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
        showToast("Entre como recrutador para publicar vagas.", "error");
        go("acesso");
        return;
    }

    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));

    const jobData = {
        recruiter_id: user.id,
        title: fields.title,
        company: fields.company,
        date: fields.date,
        time: fields.time,
        city: fields.city,
        place: fields.place,
        people: Number(fields.people),
        value: fields.value,
        description: fields.description,
        requirements: fields.requirements,
        extra: fields.extra
    };
    const query = fields.id
        ? supabaseClient.from("jobs").update(jobData).eq("id", fields.id).eq("recruiter_id", user.id)
        : supabaseClient.from("jobs").insert(jobData);
    const { error } = await query;

    if (error) {
        showToast("Não foi possível salvar a vaga: " + error.message, "error");
        console.error(error);
        return;
    }

    showToast(fields.id ? "Vaga atualizada com sucesso." : "Vaga publicada com sucesso.");
    await loadJobs();
    go("gerenciar-vagas");
}

function requestJobAction(action, jobId) {
    const job = jobs.find(item => String(item.id) === String(jobId));
    if (!job) return;

    const message = action === "delete"
        ? `Apagar a vaga "${escapeHtml(job.title)}"? Essa ação não pode ser desfeita.`
        : `${job.status === "closed" ? "Reabrir" : "Encerrar"} a vaga "${escapeHtml(job.title)}"?`;
    const confirmation = document.createElement("div");
    confirmation.className = "notice";
    confirmation.innerHTML = `
        <strong>${message}</strong>
        <div class="actions">
            <button class="${action === "delete" ? "danger" : "primary"}"
                onclick="resolveJobAction('${action}', ${safeInlineId(job.id)})">
                Confirmar
            </button>
            <button class="secondary" onclick="this.closest('.notice').remove()">
                Cancelar
            </button>
        </div>
    `;
    app.prepend(confirmation);
}

async function resolveJobAction(action, jobId) {
    const job = jobs.find(item => String(item.id) === String(jobId));
    if (!job || currentDatabaseProfile?.role !== "recruiter" ||
        currentDatabaseProfile.approved !== true) {
        showToast("Você não tem permissão para alterar esta vaga.", "error");
        return;
    }

    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
        showToast("Sua sessão expirou. Entre novamente.", "error");
        go("acesso");
        return;
    }

    const result = action === "delete"
        ? await supabaseClient.from("jobs").delete().eq("id", jobId).eq("recruiter_id", user.id)
        : await supabaseClient.from("jobs").update({
            status: job.status === "closed" ? "open" : "closed"
        }).eq("id", jobId).eq("recruiter_id", user.id);

    if (result.error) {
        showToast("Não foi possível alterar a vaga: " + result.error.message, "error");
        return;
    }

    showToast(action === "delete" ? "Vaga apagada." : "Status da vaga atualizado.");
    await loadJobs();
    go("gerenciar-vagas");
}

function showRecruiterSignup() {
    app.innerHTML = layout(
        "Criar acesso de recrutador",
        `
            <form class="form-card" onsubmit="recruiterSignup(event)">
                <div class="field">
                    <label>Nome da empresa</label>
                    <input name="company" required>
                </div>
                <div class="field" style="margin-top:12px">
                    <label>Telefone</label>
                    <input name="phone" type="tel" required>
                </div>
                <div class="field">
                    <label>E-mail</label>
                    <input name="email" type="email" required>
                </div>
                <div class="field" style="margin-top:12px">
                    <label>Senha</label>
                    <input name="password" type="password" minlength="8" required>
                </div>
                <label class="check" style="margin-top:16px">
                    <input type="checkbox" name="privacyConsent" required>
                    Li e aceito a <a href="#privacidade" target="_blank">Política de Privacidade</a>.
                </label>
                <button class="primary" style="margin-top:16px">Criar acesso</button>
                <button type="button" class="secondary" onclick="go('acesso')" style="margin-top:10px">
                    Voltar
                </button>
            </form>
        `
    );
}

async function recruiterSignup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = form.elements.email.value.trim().toLowerCase();
    const password = form.elements.password.value;
    const company = form.elements.company.value.trim();
    const phone = form.elements.phone.value.trim();
    if (!form.elements.privacyConsent.checked) {
        showToast("Aceite a Política de Privacidade para criar o acesso.", "error");
        return;
    }
    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
            data: {
                role: "recruiter",
                name: company,
                phone,
                email
            }
        }
    });

    if (error) {
        showToast("Não foi possível criar o acesso: " + getAuthErrorMessage(error), "error");
        return;
    }

    if (!data?.session || !data.user) {
        showToast("Acesso criado, mas a sessão não foi iniciada. Verifique se a confirmação de e-mail está desativada no Supabase.", "error");
        return;
    }

    localStorage.setItem(AUTH_KEY, JSON.stringify({
        role: "recruiter", approved: false, email, userId: data.user.id
    }));
    showToast("Acesso criado. Seu cadastro está em análise.");
    go("gerenciar-vagas");
}

async function workerLogin(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;

    if (!email || !password) {
        showToast("Preencha o e-mail e a senha.", "error");
        return;
    }

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (error) {
        showToast("E-mail ou senha inválidos.", "error");
        console.error("Erro no login:", error);
        return;
    }

    const { profile, error: profileError } = await fetchWorkerProfile(data.user.id);

    if (profileError) {
        showToast("Login realizado, mas não foi possível carregar seu perfil.", "error");
        return;
    }

    if (!profile || profile.role !== "worker") {
        localStorage.removeItem(PROFILE_KEY);
        localStorage.setItem(AUTH_KEY, JSON.stringify({
            role: "worker",
            email: data.user.email,
            userId: data.user.id
        }));
        showToast("Sua conta ainda não possui um cadastro de trabalhador.", "error");
        go("cadastro");
        return;
    }

    localStorage.setItem(AUTH_KEY, JSON.stringify({
        role: profile.role,
        approved: profile.approved === true,
        email: data.user.email,
        userId: data.user.id
    }));

    currentDatabaseProfile = profile;

    showToast("Login realizado com sucesso!");
    go("vagas");
}

async function recruiterLogin(event) {
    event.preventDefault();

    const email = event.target.email.value.trim().toLowerCase();
    const password = event.target.password.value;
    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        showToast("Não foi possível entrar: " + getAuthErrorMessage(error), "error");
        console.error(error);
        return;
    }

    const { data: profile, error: profileError } = await supabaseClient
        .from("profiles")
        .select("role, approved")
        .eq("id", data.user.id)
        .single();

    if (profileError) {
        showToast("Não foi possível consultar o perfil da empresa: " + profileError.message, "error");
        console.error(profileError);
        return;
    }

    if (profile?.role !== "recruiter") {
        showToast("Esta conta ainda não possui um perfil de recrutador. Crie o acesso de recrutador pelo botão correspondente.", "error");
        return;
    }

    localStorage.setItem(AUTH_KEY, JSON.stringify({
        role: "recruiter",
        approved: profile.approved === true,
        email,
        userId: data.user.id
    }));

    currentDatabaseProfile = profile;

    showToast("Acesso do recrutador realizado.");
    go("gerenciar-vagas");
}

function showPrivacy() {
    app.innerHTML = layout(
        "Política de Privacidade",
        `
            <article class="card privacy-page">
                <h3>Dados coletados</h3>
                <p>Coletamos nome, contato, cidade, informações profissionais, preferências de trabalho e foto quando você escolhe fornecê-los.</p>

                <h3>Finalidade</h3>
                <p>Usamos esses dados para criar seu perfil, permitir demonstrações de interesse e aproximar trabalhadores e empresas em oportunidades temporárias.</p>

                <h3>Quem pode ver</h3>
                <p>Trabalhadores veem as vagas. Recrutadores aprovados veem somente os dados necessários de pessoas interessadas em suas próprias vagas: nome, cidade, contato, experiência, tamanhos e foto.</p>

                <h3>Segurança e armazenamento</h3>
                <p>Os dados ficam no Supabase com controles de acesso. Fotos são armazenadas em bucket privado e exibidas por links temporários autorizados.</p>

                <h3>Seus direitos</h3>
                <p>Você pode atualizar seus dados ou excluir sua conta e os dados associados pelo botão disponível em Meu perfil. Para dúvidas ou solicitações adicionais, entre em contato pelo e-mail responsável pela plataforma.</p>

                <button class="secondary" onclick="go('acesso')" style="margin-top:20px">Voltar</button>
            </article>
        `
    );
}

function requestAccountDeletion() {
    const confirmation = document.createElement("div");
    confirmation.className = "notice";
    confirmation.innerHTML = `
        <strong>Excluir sua conta apagará seu perfil, interesses, vagas e foto. Essa ação não pode ser desfeita.</strong>
        <div class="actions">
            <button class="danger" onclick="deleteMyAccount()">Confirmar exclusão</button>
            <button class="secondary" onclick="this.closest('.notice').remove()">Cancelar</button>
        </div>
    `;
    app.prepend(confirmation);
}

async function deleteMyAccount() {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData.session?.user;

    if (!user) {
        showToast("Sua sessão expirou. Entre novamente.", "error");
        go("acesso");
        return;
    }

    const { data: profile, error: profileError } = await supabaseClient
        .from("profiles")
        .select("photo_url")
        .eq("id", user.id)
        .maybeSingle();

    if (profileError) {
        showToast("Não foi possível localizar seus dados: " + profileError.message, "error");
        return;
    }

    const photoPath = String(profile?.photo_url || "");
    if (photoPath && !photoPath.startsWith("https://") && !photoPath.startsWith("data:image/")) {
        const { error: photoError } = await supabaseClient.storage
            .from(AVATARS_BUCKET)
            .remove([photoPath]);

        if (photoError) {
            showToast("Não foi possível remover sua foto: " + photoError.message, "error");
            return;
        }
    }

    const { error } = await supabaseClient.rpc("delete_my_account");

    if (error) {
        showToast("Não foi possível excluir sua conta: " + error.message, "error");
        return;
    }

    await supabaseClient.auth.signOut();
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(INTERESTS_KEY);
    currentDatabaseProfile = null;
    window.location.hash = "#acesso";
    render();
}


async function showProfile() {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData.session?.user;

    if (!user) {
        app.innerHTML = layout(
            "Meu perfil",
            `
                <div class="card empty">
                    Você ainda não cadastrou seu perfil.
                    <br>
                    <button class="primary" onclick="go('cadastro')" style="margin-top:15px">
                        Cadastrar agora
                    </button>
                </div>
            `
        );
        return;
    }

    app.innerHTML = layout(
        "Meu perfil",
        `<div class="card empty">Carregando seus dados...</div>`
    );

    const { profile, error } = await fetchWorkerProfile(user.id);

    if (error) {
        app.innerHTML = layout(
            "Meu perfil",
            `<div class="card empty">Não foi possível carregar seu perfil.</div>`
        );
        return;
    }

    if (!profile || profile.role !== "worker") {
        localStorage.removeItem(PROFILE_KEY);
        app.innerHTML = layout(
            "Meu perfil",
            `
                <div class="card empty">
                    Você ainda não cadastrou seu perfil.
                    <br>
                    <button class="primary" onclick="go('cadastro')" style="margin-top:15px">
                        Cadastrar agora
                    </button>
                </div>
            `
        );
        return;
    }

    const profileData = {
        ...profile,
        photo: profile.photo_url || profile.photo || ""
    };
    const profilePhotoUrl = await getPhotoUrl(profileData.photo);

    const labels = {
        name: "Nome completo",
        phone: "Telefone",
        email: "E-mail",
        sex: "Sexo",
        gender: "Gênero",
        birth: "Nascimento",
        city: "Cidade",
        address: "Endereço",
        height: "Altura",
        weight: "Peso",
        shirt: "Camisa",
        pants: "Calça",
        shoe: "Tênis",
        car: "Possui carro",
        drive: "Sabe dirigir",
        license: "Possui CNH",
        education: "Escolaridade",
        experience: "Experiência",
        availability: "Disponibilidade"
    };

    const avatar = profilePhotoUrl
        ? `<img src="${profilePhotoUrl}" alt="Foto de ${escapeHtml(profileData.name)}">`
        : escapeHtml((profileData.name || "P").charAt(0).toUpperCase());
    const interests = getInterests();
    const interestedJobs = jobs.filter(job => interests.some(interest =>
        String(interest.job_id ?? interest.jobId) === String(job.id)
    ));

    app.innerHTML = layout(
        "Meu perfil",
        `
            <div class="card">
                <div class="profile-head">
                    <div class="avatar">${avatar}</div>
                    <div>
                        <h2>${escapeHtml(profileData.name)}</h2>
                        <span class="muted">
                            ${escapeHtml(profileData.city || "Cidade não informada")}
                        </span>
                    </div>
                </div>

                <div class="data">
                    ${Object.entries(labels).map(([key, label]) => {
                        if (!profileData[key] && profileData[key] !== false) return "";

                        const value = typeof profileData[key] === "boolean"
                            ? profileData[key] ? "Sim" : "Não"
                            : profileData[key];

                        return `<div><strong>${label}</strong>${value}</div>`;
                    }).join("")}
                </div>

                <button class="secondary" onclick="go('cadastro')" style="margin-top:20px">
                    Editar cadastro
                </button>
                <button class="danger" onclick="requestAccountDeletion()" style="margin-top:12px">
                    Excluir minha conta e meus dados
                </button>
            </div>

            <div class="section-title">
                <h2>Minhas demonstrações de interesse</h2>
            </div>

            <div class="card">
                <p>
                    Total de demonstrações de interesse:
                    <b>${escapeHtml(interestedJobs.length)}</b>
                </p>

                <div class="actions">
                    ${interestedJobs.length
                        ? interestedJobs.map(job => `
                            <button class="secondary"
                                onclick="go('detalhe', ${safeInlineId(job.id)})">
                                ${escapeHtml(job.title)}
                            </button>
                        `).join("")
                        : `<span class="muted">Você ainda não demonstrou interesse em nenhuma vaga.</span>`}
                </div>
            </div>
        `
    );
}

async function join(jobId) {
    const job = jobs.find(item => String(item.id) === String(jobId));

    if (!job || isJobPast(job)) {
        showToast("O prazo desta vaga já encerrou.", "error");
        return;
    }

    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData.session?.user;

    if (!user) {
        showToast("Entre na plataforma antes de demonstrar interesse.", "error");
        go("acesso");
        return;
    }

    const { profile, error: profileError } = await fetchWorkerProfile(user.id);

    if (profileError || !profile || profile.role !== "worker") {
        showToast("Cadastre seu perfil antes de demonstrar interesse.", "error");
        go("cadastro");
        return;
    }

    const interests = getInterests();

    const alreadyJoined = interests.some(item =>
        String(item.job_id ?? item.jobId) === String(jobId) &&
        (item.user_id === user.id || item.userId === user.id)
    );

    if (alreadyJoined) {
        showToast("Você já demonstrou interesse nesta vaga.", "error");
        return;
    }

    const { error } = await supabaseClient.from(INTERESTS_TABLE).insert({
        user_id: user.id,
        job_id: jobId
    });

    if (error) {
        showToast("Não foi possível registrar seu interesse: " + error.message, "error");
        console.error(error);
        return;
    }

    await loadInterests();
    showToast("Seu interesse foi registrado.");
    render();
}

async function withdrawInterest(jobId) {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const user = sessionData.session?.user;

    if (!user) {
        showToast("Entre na plataforma para retirar seu interesse.", "error");
        go("acesso");
        return;
    }

    const { error } = await supabaseClient
        .from(INTERESTS_TABLE)
        .delete()
        .eq("job_id", jobId)
        .eq("user_id", user.id);

    if (error) {
        showToast("Não foi possível retirar o interesse: " + error.message, "error");
        return;
    }

    await loadInterests();
    showToast("Interesse retirado.");
    render();
}

async function showInterested(jobId) {
    if (currentDatabaseProfile?.role !== "recruiter" ||
        currentDatabaseProfile.approved !== true) {
        showToast("Esta área é exclusiva para recrutadores.", "error");
        go("acesso");
        return;
    }

    const job = jobs.find(item => String(item.id) === String(jobId));

    if (!job) {
        app.innerHTML = layout("Vaga não encontrada",
            `<div class="card empty">Esta vaga não existe.</div>`
        );
        return;
    }

    const { data: interestRows, error } = await supabaseClient
        .from(INTERESTS_TABLE)
        .select("user_id, job_id, created_at")
        .eq("job_id", jobId)
        .order("created_at", { ascending: true });

    if (error) {
        console.error("Não foi possível carregar os interessados:", error);
        app.innerHTML = layout(
            `Interessados: ${escapeHtml(job.title)}`,
            `<div class="card empty">Não foi possível carregar os interessados.</div>`
        );
        return;
    }

    const userIds = [...new Set((interestRows || []).map(item => item.user_id))];
    let profilesById = {};

    if (userIds.length) {
        const { data: profiles, error: profilesError } = await supabaseClient
            .from("profiles")
            .select("*")
            .in("id", userIds);

        if (profilesError) {
            console.error("Não foi possível carregar os perfis interessados:", profilesError);
            app.innerHTML = layout(
                `Interessados: ${escapeHtml(job.title)}`,
                `<div class="card empty">Não foi possível carregar os perfis dos interessados: ${escapeHtml(profilesError.message)}</div>`
            );
            return;
        }

        profilesById = Object.fromEntries(
            (profiles || []).map(profile => [profile.id, profile])
        );
    }

    const people = (interestRows || [])
        .map((item, index) => ({
            index,
            jobId: item.job_id,
            userId: item.user_id,
            createdAt: item.created_at,
            profile: profilesById[item.user_id]
                ? {
                    ...profilesById[item.user_id],
                    photo: profilesById[item.user_id].photo_url || ""
                }
                : null
        }))
        .filter(item => item.profile);

    localStorage.setItem(INTERESTS_KEY, JSON.stringify(people));

    app.innerHTML = layout(
        `Interessados: ${escapeHtml(job.title)}`,
        `
            <div class="card">
                <p><b>Vaga:</b> ${escapeHtml(job.title)}</p>
                <p><b>Quantidade de pessoas interessadas:</b> ${escapeHtml(people.length)}</p>
            </div>

            <div class="grid" style="margin-top:18px">
                ${
                    people.length
                        ? people.map(item => personCard(item, jobId)).join("")
                        : `<div class="card empty">Ainda não há pessoas interessadas nesta vaga.</div>`
                }
            </div>
        `
    );
}

function personCard(item, jobId) {
    const person = item.profile;

    return `
        <article class="card person-card">
            <h3>${escapeHtml(person.name || "Nome não informado")}</h3>
            <span class="muted">${escapeHtml(person.city || "Cidade não informada")}</span>
            <span>${escapeHtml(person.email || "E-mail não informado")}</span>

            <button class="secondary"
                onclick="go('interessado', ${safeInlineId(jobId)}, ${safeInlineId(item.userId)})">
                Abrir perfil
            </button>
        </article>
    `;
}

async function showInterestedProfile(jobId, userId) {
    if (currentDatabaseProfile?.role !== "recruiter" ||
        currentDatabaseProfile.approved !== true) {
        showToast("Esta área é exclusiva para recrutadores.", "error");
        go("acesso");
        return;
    }

    const { data: person, error } = await supabaseClient
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

    if (error) {
        console.error("Não foi possível carregar o perfil interessado:", error);
        app.innerHTML = layout(
            "Perfil do interessado",
            `<div class="card empty">Não foi possível carregar o perfil: ${escapeHtml(error.message)}</div>`
        );
        return;
    }

    if (!person) {
        app.innerHTML = layout(
            "Perfil não encontrado",
            `<div class="card empty">O perfil interessado não foi encontrado.</div>`
        );
        return;
    }

    person.photo = person.photo_url || "";
    const personPhotoUrl = await getPhotoUrl(person.photo);

    const fields = [
        ["name", "Nome completo"],
        ["city", "Cidade"],
        ["phone", "Telefone"],
        ["email", "E-mail"],
        ["experience", "Experiência"],
        ["car", "Possui carro"],
        ["drive", "Sabe dirigir"],
        ["shirt", "Tamanho da camisa"],
        ["pants", "Tamanho da calça"],
        ["shoe", "Tamanho do tênis"]
    ];
    const whatsappUrl = getWhatsappUrl(person.phone);

    app.innerHTML = layout(
        "Perfil do interessado",
        `
            <div class="card">
               <div class="profile-head">
    <div class="avatar">
        ${
            personPhotoUrl
                ? `<img src="${personPhotoUrl}" alt="Foto de ${escapeHtml(person.name)}">`
                : escapeHtml((person.name || "P").charAt(0).toUpperCase())
        }
    </div>

    <div>
        <h2>${escapeHtml(person.name || "Nome não informado")}</h2>
        <span class="muted">Interessado em uma vaga</span>
    </div>
</div>
                    ${fields.map(([key, label]) => {
                        let value = person[key];

                        if (typeof value === "boolean") {
                            value = value ? "Sim" : "Não";
                        }

                        return `
                            <div>
                                <strong>${label}</strong>
                                ${escapeHtml(value || "Não informado")}
                            </div>
                        `;
                    }).join("")}
                </div>

                ${whatsappUrl ? `
                    <a class="secondary" href="${whatsappUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:20px">
                        Falar pelo WhatsApp
                    </a>
                ` : ""}

                <button class="secondary"
                    onclick="go('interessados', ${safeInlineId(jobId)})"
                    style="margin-top:20px">
                    Voltar para interessados
                </button>
            </div>
        `
    );
}

window.addEventListener("hashchange", render);
window.addEventListener("popstate", render);
if (!window.location.hash) {
    window.location.hash = "#inicio";
}
render();
loadJobs();