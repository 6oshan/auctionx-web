/* =========================================
   GLOBAL VARIABLES
========================================= */

let teams = [];
let players = [];
let soldPlayers = [];

let tournamentNameGlobal = '';
let tournamentBanner =
    './images/default/bannerDefault.png';
let playerImageFolder = '';
let selectedPlayerSl = '';
const defaultPlayerImage =
    './images/default/playerDefault.png';

// Photo lookup: SL number -> base64 image, populated by ZIP upload.
let zipPhotos = {};

// Tracks the most recent sale so the owners' live view can show it.
let lastSold = null;

// Local live-server state (owner live view over hotspot/Wi-Fi).
let liveServerInfo = null;

// Players added by hand on the setup screen, before the auction starts.
let manualPlayers = [];

// Redo stack: sales popped off by "Undo" land here so "Redo" can restore them.
let redoStack = [];

// SL numbers of players currently sitting in the "unsold, awaiting a
// second round" pool, in the order they should be recalled.
let unsoldQueue = [];

// The player the auctioneer currently has pulled up on screen (via
// Find Player), pushed to the owners' Live View so it can pop up
// automatically. playerSelectionToken increments on every new find so
// the viewer can detect "a new player was selected" even if the same
// SL number is searched twice in a row.
let currentAuctionPlayer = null;
let playerSelectionToken = 0;

// =========================================
// REMOTE LIVE VIEW (Firebase — works over the internet,
// not just the local Wi-Fi hotspot). Fully optional: if
// firebase-config.js hasn't been filled in, all of this
// silently does nothing and the rest of the app is unaffected.
// =========================================
let remoteLiveViewActive = false;
let currentTournamentId = null;
let firebaseSdkLoaded = false;
let firestoreDb = null;
let firebaseUserId = null;

/* =========================================
   SAVE DATA
========================================= */

/* =========================================
   CUSTOM DIALOGS (replace system alert/confirm)
========================================= */

let appDialogInstance = null;

function validatePlayerFileInput(input) {

    const file =
        input.files[0];

    if (!file) {

        return;
    }

    const allowedExtensions =
        ['csv', 'xlsx', 'xls'];

    const fileExtension =
        file.name
            .split('.')
            .pop()
            .toLowerCase();

    if (!allowedExtensions.includes(fileExtension)) {

        input.value = '';

        showAlert(
            '"' + file.name + '" is not a supported file. ' +
            'Please upload a .csv, .xlsx, or .xls file with player details.'
        );
    }
}

function getAppDialog() {

    if (!appDialogInstance) {

        const modalEl =
            document.getElementById('appDialogModal');

        appDialogInstance = new bootstrap.Modal(modalEl);

        // The player-card popup (and any other modal) may already be open
        // when this dialog is triggered (e.g. "Player already sold" while
        // the player popup is up). Bootstrap doesn't automatically stack
        // modals in front of each other, so force this one to the very
        // top every time it's shown.
        modalEl.addEventListener('shown.bs.modal', function () {

            modalEl.style.zIndex = 1090;

            const backdrops =
                document.querySelectorAll('.modal-backdrop');

            if (backdrops.length) {

                backdrops[backdrops.length - 1].style.zIndex = 1085;
            }
        });
    }

    return appDialogInstance;
}

function showAlert(message, options = {}) {

    const title = options.title || 'Notice';
    const tone = options.tone || 'info';
    const iconClass =
        tone === 'danger' ? 'fa-circle-exclamation' :
        tone === 'success' ? 'fa-circle-check' :
        'fa-circle-info';

    document.getElementById('appDialogIcon').className =
        'app-dialog-icon mb-3' + (tone !== 'info' ? ' ' + tone : '');

    document.getElementById('appDialogIcon').innerHTML =
        `<i class="fa ${iconClass}"></i>`;

    document.getElementById('appDialogTitle').innerText = title;
    document.getElementById('appDialogMessage').innerText = message;

    document.getElementById('appDialogButtons').innerHTML =
        `<button class="btn btn-primary-custom px-4" data-bs-dismiss="modal">OK</button>`;

    getAppDialog().show();
}

function showConfirm(message, onConfirm, options = {}) {

    const title = options.title || 'Please confirm';

    document.getElementById('appDialogIcon').className =
        'app-dialog-icon mb-3';

    document.getElementById('appDialogIcon').innerHTML =
        '<i class="fa fa-circle-question"></i>';

    document.getElementById('appDialogTitle').innerText = title;
    document.getElementById('appDialogMessage').innerText = message;

    document.getElementById('appDialogButtons').innerHTML = `
        <button class="btn btn-outline-light px-4" data-bs-dismiss="modal">Cancel</button>
        <button class="btn btn-primary-custom px-4" id="appDialogConfirmBtn">Yes, Continue</button>
    `;

    document.getElementById('appDialogConfirmBtn').onclick = function () {

        getAppDialog().hide();
        onConfirm();
    };

    getAppDialog().show();
}

/* =========================================
   THEME (light / dark)
========================================= */

function applyAppTheme(theme) {

    document.documentElement.setAttribute('data-theme', theme);
}

function toggleAppTheme() {

    const current =
        localStorage.getItem('appTheme') || 'dark';

    const next =
        current === 'dark' ? 'light' : 'dark';

    localStorage.setItem('appTheme', next);

    applyAppTheme(next);
}

applyAppTheme(localStorage.getItem('appTheme') || 'dark');

function saveAuctionData() {

    const data = {

        teams,
        players,
        soldPlayers,
        tournamentNameGlobal,
        tournamentBanner,
        playerImageFolder,
        zipPhotos,
        unsoldQueue,
        currentTournamentId

    };

    try {

        localStorage.setItem(
            'auctionData',
            JSON.stringify(data)
        );

    } catch (e) {

        // Most likely a quota error from too many/too large zipped photos.
        console.error('Save failed', e);

        showAlert(
            'Could not save — your device storage is full. ' +
            'This is usually caused by too many player photos uploaded ' +
            'via ZIP. Try compressing photos before zipping, or use the ' +
            'Player Image Folder URL option instead.'
        );
    }

    // Kept as its own tiny, separate save — deliberately independent of
    // the (much larger, photo-laden) save above. If that one ever fails
    // due to a storage quota issue, this still succeeds, so the Remote
    // View link/QR code the auctioneer already shared with owners
    // doesn't silently start pointing at a dead tournament ID.
    if (currentTournamentId) {

        try {

            localStorage.setItem(
                'auctionTournamentId',
                currentTournamentId
            );

        } catch (e) {

            console.error('Could not save tournament ID', e);
        }
    }

    pushStateToLiveServer();
}

/* =========================================
   LOAD DATA
========================================= */

function loadAuctionData() {

    const savedData =
        localStorage.getItem('auctionData');

    if (savedData) {

        const parsedData =
            JSON.parse(savedData);

        teams =
            parsedData.teams || [];

        players =
            parsedData.players || [];

        soldPlayers =
            parsedData.soldPlayers || [];

        tournamentNameGlobal =
            parsedData.tournamentNameGlobal || '';

        tournamentBanner =
            parsedData.tournamentBanner ||
            './images/default/bannerDefault.png';

        playerImageFolder =
            parsedData.playerImageFolder || '';

        zipPhotos =
            parsedData.zipPhotos || {};

        unsoldQueue =
            parsedData.unsoldQueue || [];

        currentTournamentId =
            parsedData.currentTournamentId ||
            localStorage.getItem('auctionTournamentId') ||
            null;


        if (teams.length > 0) {

            renderUnsoldPool();

            document
                .getElementById('setupScreen')
                .classList.remove('active');

            document
                .getElementById('auctionScreen')
                .classList.add('active');

            document
                .getElementById('auctionTournamentName')
                .innerText =
                tournamentNameGlobal;

            document
                .getElementById('tournamentBannerPreview')
                .src =
                tournamentBanner;

            loadTeams();
        }
    }
}

/* =========================================
   PAGE LOAD
========================================= */

window.onload = function () {

    loadAuctionData();
    renderManualPlayersTable();
}

/* =========================================
   CALCULATE MAX PRICE
========================================= */

function calculateMaxPrice() {

    const amount =
        parseInt(
            document.getElementById('teamAmount').value
        ) || 0;

    const playersCount =
        parseInt(
            document.getElementById('playersPerTeam').value
        ) || 0;

    const basePrice =
        parseInt(
            document.getElementById('basePrice').value
        ) || 0;

    if (playersCount <= 0) {

        document.getElementById('maxPrice').value = 0;
        return;
    }

    const maxPrice =
        amount -
        ((playersCount - 1) * basePrice);

    document.getElementById('maxPrice').value =
        maxPrice > 0 ? maxPrice : 0;
}

/* =========================================
   GENERATE TEAM INPUTS
========================================= */

function generateTeamInputs() {

    const totalTeams =
        document.getElementById('totalTeams').value;

    const teamInputs =
        document.getElementById('teamInputs');

    teamInputs.innerHTML = '';

    for (let i = 1; i <= totalTeams; i++) {

        teamInputs.innerHTML += `

            <div class="col-md-4 mb-4">

                <div class="team-input-card">

                    <label class="mb-2">
                        Team ${i} Name
                    </label>

                    <input type="text"
                        class="form-control team-name mb-3"
                        placeholder="Enter Team Name">

                    <label class="mb-2">
                        Team Logo
                        <small class="opacity-50">
                            (Optional)
                        </small>
                    </label>

                    <input type="file"
                        class="form-control team-logo"
                        accept="image/*">

                </div>

            </div>

        `;
    }

    teamInputs.innerHTML += `

        

    `;
}

/* =========================================
   START AUCTION
========================================= */

async function startAuction() {

    const tournamentName =
        document.getElementById('tournamentName').value;

    tournamentNameGlobal =
        tournamentName;

    const playersPerTeam =
        parseInt(
            document.getElementById('playersPerTeam').value
        ) || 0;

    const teamAmount =
        parseInt(
            document.getElementById('teamAmount').value
        ) || 0;

    const basePrice =
        parseInt(
            document.getElementById('basePrice').value
        ) || 0;

    const maxPrice =
        parseInt(
            document.getElementById('maxPrice').value
        ) || 0;

    playerImageFolder =
        document
            .getElementById(
                'playerImageFolder'
            )
            .value
            .trim();

    if (
        teamAmount <= 0 ||
        playersPerTeam <= 0 ||
        basePrice <= 0
    ) {

        showAlert('Please enter valid values');
        return;
    }

    const teamInputs =
        document.querySelectorAll('.team-name');

    const logoInputs =
        document.querySelectorAll('.team-logo');

    teams = [];

    for (let index = 0; index < teamInputs.length; index++) {

        const input =
            teamInputs[index];

        let logoUrl =
            './images/default/teamDefault.png';

        const logoFile =
            logoInputs[index].files[0];

        if (logoFile) {

            try {

                logoUrl =
                    await compressImageBlob(logoFile, 300);

            } catch (e) {

                logoUrl =
                    await fileToBase64(logoFile);
            }
        }

        teams.push({

            name:
                input.value ||
                `Team ${index + 1}`,

            logo:
                logoUrl,

            balance:
                teamAmount,

            players: [],

            playersRemaining:
                playersPerTeam,

            basePrice,

            maxPrice

        });

    }

    const bannerFile =
        document.getElementById('tournamentBanner')?.files[0];

    if (bannerFile) {

        try {

            tournamentBanner =
                await compressImageBlob(bannerFile, 900);

        } catch (e) {

            tournamentBanner =
                await fileToBase64(bannerFile);
        }
    }

    const file =
        document.getElementById('playerFile').files[0];

    if (!file && manualPlayers.length === 0) {

        showAlert(
            'Upload a player Excel/CSV file, add players manually, or both.'
        );
        return;
    }

    function finishStartingAuction() {

        // Manually-added players go in first; anything from the
        // uploaded file with a matching SL number is skipped so the
        // manual entry (which may carry mobile/role info) wins.
        const manualSlSet =
            new Set(manualPlayers.map(p => String(p.sl).trim()));

        players = manualPlayers.map(p => ({ ...p }));

        filePlayers.forEach(p => {

            if (!manualSlSet.has(String(p.sl).trim())) {

                players.push(p);
            }
        });

        document
            .getElementById('setupScreen')
            .classList.remove('active');

        document
            .getElementById('auctionScreen')
            .classList.add('active');

        document
            .getElementById('auctionTournamentName')
            .innerText =
            tournamentNameGlobal;

        document
            .getElementById('tournamentBannerPreview')
            .src =
            tournamentBanner;

        window.scrollTo({

            top: 0,

            behavior: 'smooth'
        });

        loadTeams();

        saveAuctionData();
    }

    let filePlayers = [];

    if (!file) {

        finishStartingAuction();
        return;
    }

    const reader =
        new FileReader();

    const fileExtension =
        file.name
            .split('.')
            .pop()
            .toLowerCase();

    reader.onload = function (e) {

        filePlayers = [];

        const allowedExtensions =
            ['csv', 'xlsx', 'xls'];

        if (!allowedExtensions.includes(fileExtension)) {

            showAlert(
                '"' + file.name + '" is not a supported player file. ' +
                'Please upload a .csv, .xlsx, or .xls file instead.'
            );
            return;
        }

        try {

        if (fileExtension === 'csv') {

            const rows =
                e.target.result.split('\n');

            rows.slice(1).forEach(row => {

                const cols =
                    row.split(',');

                if (cols.length >= 2 && cols[0].trim() && cols[1].trim()) {

                    filePlayers.push({

                        sl:
                            cols[0].trim(),

                        name:
                            cols[1].trim(),

                        mobile:
                            (cols[2] || '').trim(),

                        role:
                            (cols[3] || '').trim(),

                        sold: false
                    });
                }
            });

        } else {

            const data =
                new Uint8Array(
                    e.target.result
                );

            const workbook =
                XLSX.read(data, {
                    type: 'array'
                });

            const worksheet =
                workbook.Sheets[
                workbook.SheetNames[0]
                ];

            const jsonData =
                XLSX.utils.sheet_to_json(
                    worksheet,
                    {
                        header: 1
                    }
                );

            jsonData.slice(1).forEach(row => {

                if (row.length >= 2 && row[0] != null && row[1] != null && String(row[1]).trim()) {

                    filePlayers.push({

                        sl:
                            String(row[0]).trim(),

                        name:
                            String(row[1]).trim(),

                        mobile:
                            row[2] != null ? String(row[2]).trim() : '',

                        role:
                            row[3] != null ? String(row[3]).trim() : '',

                        sold: false
                    });
                }
            });
        }

        } catch (err) {

            console.error('Player file parsing failed', err);

            showAlert(
                '"' + file.name + '" could not be read as a player file. ' +
                'Make sure it\'s a valid .csv, .xlsx, or .xls file and try again.'
            );
            return;
        }

        finishStartingAuction();
    }

    if (fileExtension === 'csv') {

        reader.readAsText(file);

    } else {

        reader.readAsArrayBuffer(file);
    }
}

/* =========================================
   MANUAL PLAYER ENTRY (setup screen, before auction starts)
========================================= */

function addManualPlayer() {

    const sl =
        document.getElementById('manualPlayerSl').value.trim();

    const name =
        document.getElementById('manualPlayerName').value.trim();

    const mobile =
        document.getElementById('manualPlayerMobile').value.trim();

    const role =
        document.getElementById('manualPlayerRole').value;

    if (!sl || !name) {

        showAlert('Enter at least the SL number and player name.');
        return;
    }

    if (manualPlayers.find(p => String(p.sl).trim() === sl)) {

        showAlert('That SL number is already in the manual list.');
        return;
    }

    manualPlayers.push({

        sl,
        name,
        mobile,
        role,
        sold: false

    });

    document.getElementById('manualPlayerSl').value = '';
    document.getElementById('manualPlayerName').value = '';
    document.getElementById('manualPlayerMobile').value = '';
    document.getElementById('manualPlayerRole').value = '';

    renderManualPlayersTable();
}

function removeManualPlayer(sl) {

    manualPlayers =
        manualPlayers.filter(p => String(p.sl).trim() !== String(sl).trim());

    renderManualPlayersTable();
}

function renderManualPlayersTable() {

    const container =
        document.getElementById('manualPlayerTable');

    if (!container) return;

    if (manualPlayers.length === 0) {

        container.innerHTML =
            '<div class="opacity-50 mt-2">No players added manually yet.</div>';
        return;
    }

    container.innerHTML =
        manualPlayers.map(p => `

            <div class="manual-player-row">

                <div>
                    #${p.sl} - ${p.name}
                    ${p.role ? `<span class="role-tag">${p.role}</span>` : ''}
                    ${p.mobile ? `<span class="opacity-50 ms-2">${p.mobile}</span>` : ''}
                </div>

                <button class="delete-btn" onclick="removeManualPlayer('${p.sl}')">
                    <i class="fa fa-trash"></i>
                </button>

            </div>

        `).join('');
}

/* =========================================
   DOWNLOAD PLAYER EXCEL TEMPLATE
========================================= */

function downloadPlayerTemplate() {

    const worksheetData = [

        ['SL No', 'Player Name', 'Mobile Number', 'Batsman/Bowler'],
        [1, 'John Doe', '9876543210', 'Batsman'],
        [2, 'Sam Smith', '', 'Bowler'],
        [3, 'Alex Roy', '', '']

    ];

    const worksheet =
        XLSX.utils.aoa_to_sheet(worksheetData);

    worksheet['!cols'] = [
        { wch: 8 }, { wch: 24 }, { wch: 16 }, { wch: 16 }
    ];

    const workbook =
        XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        workbook, worksheet, 'Players'
    );

    XLSX.writeFile(
        workbook, 'player-list-template.xlsx'
    );
}

/* =========================================
   LOAD TEAMS
========================================= */

function loadTeams() {

    const teamSelect =
        document.getElementById('teamSelect');

    teamSelect.innerHTML = '';

    teams.forEach((team, index) => {

        const isFull =
            team.playersRemaining <= 0;

        teamSelect.innerHTML += `

            <option value="${index}" ${isFull ? 'disabled' : ''}>
                ${team.name}${isFull ? ' — FULL' : ''}
            </option>

        `;
    });

    renderSummary();
    renderUnsoldPool();
}

/* =========================================
   FIND PLAYER
========================================= */

function findPlayer() {

    const number =
        document.getElementById('playerNumber').value;

    const player =
        players.find(
            p => String(p.sl).trim() ===
                String(number).trim()
        );

    if (!player) {

        document.getElementById(
            'playerName'
        ).innerText =
            'Player Not Found';

        return;
    }

    document.getElementById(
        'playerName'
    ).innerText =
        player.name +
        (player.unsold ? ' (Round ' + (player.round || 2) + ' — previously unsold)' : '');

    selectedPlayerSl = player.sl;

    document.getElementById(
        'popupPlayerName'
    ).innerText =
        player.name;

    const roundBadge =
        document.getElementById('popupRoundBadge');

    if (player.unsold) {

        roundBadge.style.display = 'inline-block';
        roundBadge.innerText = 'Round ' + (player.round || 2) + ' — previously unsold';

    } else {

        roundBadge.style.display = 'none';
    }

    const markUnsoldBtn =
        document.getElementById('markUnsoldBtn');

    if (markUnsoldBtn) {

        markUnsoldBtn.style.display =
            player.sold ? 'none' : 'block';
    }

    const imageUrl =
        getPlayerImage(player.sl)

    document.getElementById(
        'playerPhotoPreview'
    ).src =
        imageUrl;

    document.getElementById(
        'playerPhotoPreview'
    ).onerror =
        function () {

            this.src =
                defaultPlayerImage;
        };

    // Push this player straight to the owners' Live View so it can pop
    // up automatically there, with no action needed from the owners.
    playerSelectionToken++;

    currentAuctionPlayer = {

        sl: player.sl,
        name: player.name,
        photo: imageUrl,
        token: playerSelectionToken

    };

    pushStateToLiveServer();

    const teamSelect =
        document.getElementById(
            'popupTeamSelect'
        );

    teamSelect.innerHTML = '';

    teams.forEach((team, index) => {

        const isFull =
            team.playersRemaining <= 0;

        teamSelect.innerHTML += `
            <option value="${index}" ${isFull ? 'disabled' : ''}>
                ${team.name}${isFull ? ' — FULL' : ''}
            </option>
        `;
    });

    const modal =
        new bootstrap.Modal(
            document.getElementById(
                'playerModal'
            )
        );

    modal.show();
}

/* =========================================
   ADD NEW PLAYER
========================================= */

function addNewPlayer() {

    const sl =
        document.getElementById('newPlayerSl').value;

    const name =
        document.getElementById('newPlayerName').value;

    const mobile =
        document.getElementById('newPlayerMobile') ?
            document.getElementById('newPlayerMobile').value.trim() : '';

    const role =
        document.getElementById('newPlayerRole') ?
            document.getElementById('newPlayerRole').value : '';

    if (!sl || !name) {

        showAlert('Enter player details');
        return;
    }

    const exists =
        players.find(
            player => player.sl == sl
        );

    if (exists) {

        showAlert('SL number already exists');
        return;
    }

    players.push({

        sl: String(sl),

        name,

        mobile,

        role,

        sold: false
    });

    saveAuctionData();

    showAlert('Player added successfully');

    document.getElementById('newPlayerSl').value = '';

    document.getElementById('newPlayerName').value = '';

    if (document.getElementById('newPlayerMobile')) {
        document.getElementById('newPlayerMobile').value = '';
    }

    if (document.getElementById('newPlayerRole')) {
        document.getElementById('newPlayerRole').value = '';
    }
}

/* =========================================
   SELL PLAYER
========================================= */

function sellPlayer() {

    const number =
        document.getElementById('playerNumber').value;

    const price =
        parseInt(
            document.getElementById('soldPrice').value
        );

    const teamIndex =
        document.getElementById('teamSelect').value;

    const player =
        players.find(
            p =>
                String(p.sl).trim() ===
                String(number).trim()
        );

    if (!player) {

        showAlert('Player not found');
        return;
    }

    if (player.sold) {

        showAlert('Player already sold');
        return;
    }

    if (!price || price <= 0) {

        showAlert('Enter valid sold price');
        return;
    }

    const team =
        teams[teamIndex];

    if (team.playersRemaining <= 0) {

        showAlert(
            team.name + ' already has its full quota of players — there are no slots left.',
            { title: 'Team is full', tone: 'danger' }
        );
        return;
    }

    const maxBid =
        team.balance -
        ((team.playersRemaining - 1) * team.basePrice);

    if (price > maxBid) {

        showAlert('Exceeds max bid');
        return;
    }

    player.sold = true;
    player.unsold = false;

    unsoldQueue =
        unsoldQueue.filter(sl => sl !== player.sl);

    const playerData = {

        sl: player.sl,

        name: player.name,

        price
    };

    team.players.push(playerData);

    team.balance -= price;

    team.playersRemaining -= 1;

    soldPlayers.push({

        player: player.name,

        team: team.name,

        price,

        teamIndex,

        sl: player.sl
    });

    redoStack = [];

    currentAuctionPlayer = null;

    document.getElementById('playerNumber').value = '';

    document.getElementById('soldPrice').value = '';

    document.getElementById('playerName').innerText = '-';

    lastSold = {
        playerName: player.name,
        teamName: team.name,
        price
    };

    saveAuctionData();

    renderUnsoldPool();

    renderSummary();

    showSoldAnimation(
        player.name,
        team.name,
        price,
        team.logo
    );
}

function sellPlayerFromPopup() {

    const teamIndex =
        document.getElementById(
            'popupTeamSelect'
        ).value;

    const price =
        parseInt(
            document.getElementById(
                'popupSoldPrice'
            ).value
        );

    const player =
        players.find(
            p => p.sl == selectedPlayerSl
        );

    if (!player) {

        showAlert('Player not found');
        return;
    }

    if (player.sold) {

        showAlert('Player already sold');
        return;
    }

    if (!price || price <= 0) {

        showAlert('Enter valid amount');
        return;
    }

    const team =
        teams[teamIndex];

    if (team.playersRemaining <= 0) {

        showAlert(
            team.name + ' already has its full quota of players — there are no slots left.',
            { title: 'Team is full', tone: 'danger' }
        );
        return;
    }

    const maxBid =
        team.balance -
        ((team.playersRemaining - 1) * team.basePrice);

    if (price > maxBid) {

        showAlert('Exceeds max bid');
        return;
    }

    player.sold = true;
    player.unsold = false;

    unsoldQueue =
        unsoldQueue.filter(sl => sl !== player.sl);

    redoStack = [];

    currentAuctionPlayer = null;

    team.players.push({

        sl: player.sl,
        name: player.name,
        price: price

    });

    team.balance -= price;

    team.playersRemaining--;

    saveAuctionData();

    renderSummary();

    renderUnsoldPool();

    soldPlayers.push({

        player: player.name,
        team: team.name,
        price: price,
        teamIndex: teamIndex,
        sl: player.sl

    });

    lastSold = {
        playerName: player.name,
        teamName: team.name,
        price
    };

    saveAuctionData();

    renderSummary();

    showSoldAnimation(
        player.name,
        team.name,
        price,
        team.logo
    );

    const modal =
        bootstrap.Modal.getInstance(
            document.getElementById(
                'playerModal'
            )
        );

    if (modal) {

        modal.hide();

        document.body.classList.remove('modal-open');

        document.querySelectorAll('.modal-backdrop')
            .forEach(el => el.remove());
    }

    document.getElementById(
        'playerNumber'
    ).value = '';

    document.getElementById(
        'playerName'
    ).innerText = '-';

    document.getElementById(
        'popupSoldPrice'
    ).value = '';
}

/* =========================================
   UNDO LAST AUCTION
========================================= */

function undoOneSale(showConfirmation) {

    if (soldPlayers.length === 0) {

        if (showConfirmation) {
            showAlert('No auction history yet.');
        }
        return false;
    }

    const last =
        soldPlayers.pop();

    const team =
        teams[last.teamIndex];

    team.balance += last.price;

    team.playersRemaining += 1;

    team.players =
        team.players.filter(
            player => player.sl !== last.sl
        );

    const player =
        players.find(
            p => p.sl == last.sl
        );

    if (player) {

        player.sold = false;
    }

    redoStack.push(last);

    saveAuctionData();

    renderSummary();

    return true;
}

function undoLastAuction() {

    if (soldPlayers.length === 0) {

        showAlert('No auction history yet.');
        return;
    }

    showConfirm(
        'This will reverse the most recent sale and refund the team. ' +
        'Click Undo again for earlier sales — it steps back one sale at ' +
        'a time — or use History to jump back multiple sales at once.',
        function () {

            undoOneSale(true);
        },
        { title: 'Undo last auction?' }
    );
}

/* =========================================
   REDO LAST UNDONE AUCTION
========================================= */

function redoLastAuction() {

    if (redoStack.length === 0) {

        showAlert('Nothing to redo.');
        return;
    }

    const record =
        redoStack.pop();

    const team =
        teams[record.teamIndex];

    const player =
        players.find(
            p => p.sl == record.sl
        );

    if (!team || !player) {

        showAlert('Could not redo — team or player no longer exists.');
        return;
    }

    if (team.playersRemaining <= 0) {

        showAlert(
            team.name + ' is full again — cannot redo this sale.',
            { title: 'Team is full', tone: 'danger' }
        );
        return;
    }

    player.sold = true;

    team.players.push({

        sl: player.sl,
        name: player.name,
        price: record.price

    });

    team.balance -= record.price;

    team.playersRemaining -= 1;

    soldPlayers.push(record);

    saveAuctionData();

    renderSummary();
}

/* =========================================
   UNDO HISTORY (multi-step undo)
========================================= */

function showUndoHistory() {

    const body =
        document.getElementById('undoHistoryBody');

    if (soldPlayers.length === 0) {

        body.innerHTML =
            '<p class="opacity-75 text-center mb-0">No sales yet to undo.</p>';

    } else {

        // Most recent sale first.
        const rows =
            soldPlayers
                .map((sale, index) => ({ sale, index }))
                .reverse();

        body.innerHTML = rows.map(({ sale, index }) => `

            <div class="undo-history-row">

                <div>
                    <div class="fw-bold">#${sale.sl} - ${sale.player}</div>
                    <small class="opacity-75">${sale.team} &middot; ₹ ${sale.price}</small>
                </div>

                <button class="btn btn-warning btn-sm" onclick="undoToStep(${index})">
                    Undo to here
                </button>

            </div>

        `).join('');
    }

    const modal =
        new bootstrap.Modal(
            document.getElementById('undoHistoryModal')
        );

    modal.show();
}

function undoToStep(index) {

    const stepsToUndo =
        soldPlayers.length - index;

    showConfirm(
        'This will reverse ' + stepsToUndo + ' sale(s) — everything sold ' +
        'from that point onward — and refund the affected teams.',
        function () {

            for (let i = 0; i < stepsToUndo; i++) {

                undoOneSale(false);
            }

            const modal =
                bootstrap.Modal.getInstance(
                    document.getElementById('undoHistoryModal')
                );

            if (modal) modal.hide();
        },
        { title: 'Undo ' + stepsToUndo + ' sale(s)?' }
    );
}

/* =========================================
   REMOVE PLAYER
========================================= */

function removePlayer(teamIndex, playerSl) {

    showConfirm(
        'This will remove the player and refund the sold amount to the team.',
        function () {

            const team =
                teams[teamIndex];

            const playerIndex =
                team.players.findIndex(
                    player => player.sl == playerSl
                );

            if (playerIndex === -1) return;

            const removedPlayer =
                team.players[playerIndex];

            team.balance += removedPlayer.price;

            team.playersRemaining += 1;

            team.players.splice(playerIndex, 1);

            const player =
                players.find(
                    p => p.sl == playerSl
                );

            if (player) {

                player.sold = false;
            }

            soldPlayers =
                soldPlayers.filter(
                    item => item.sl != playerSl
                );

            saveAuctionData();

            renderSummary();
        },
        { title: 'Remove this player?' }
    );
}

/* =========================================
   UNSOLD POOL — mark unsold, recall for another round
========================================= */

function markPlayerUnsold(sl) {

    const player =
        players.find(
            p => String(p.sl).trim() === String(sl).trim()
        );

    if (!player) {

        showAlert('Player not found');
        return;
    }

    if (player.sold) {

        showAlert('This player is already sold. Undo the sale first if you need to re-auction them.');
        return;
    }

    player.unsold = true;
    player.round = (player.round || 1) + 1;

    if (!unsoldQueue.includes(player.sl)) {

        unsoldQueue.push(player.sl);
    }

    // The auctioneer has made a decision on this player — clear them
    // from the Live View so the owners' popup closes.
    currentAuctionPlayer = null;

    saveAuctionData();

    renderUnsoldPool();

    showAlert(
        player.name + ' has been marked unsold and added to the pool for another round.',
        { title: 'Marked Unsold', tone: 'success' }
    );
}

function markCurrentPlayerUnsold() {

    if (!selectedPlayerSl) {

        showAlert('Find a player first.');
        return;
    }

    markPlayerUnsold(selectedPlayerSl);

    document.getElementById('playerNumber').value = '';
    document.getElementById('playerName').innerText = '-';

    const markUnsoldBtn =
        document.getElementById('markUnsoldBtn');

    if (markUnsoldBtn) markUnsoldBtn.style.display = 'none';
}

function markPopupPlayerUnsold() {

    if (!selectedPlayerSl) {

        showAlert('No player selected.');
        return;
    }

    markPlayerUnsold(selectedPlayerSl);

    const modal =
        bootstrap.Modal.getInstance(
            document.getElementById('playerModal')
        );

    if (modal) {

        modal.hide();

        document.body.classList.remove('modal-open');

        document.querySelectorAll('.modal-backdrop')
            .forEach(el => el.remove());
    }

    document.getElementById('playerNumber').value = '';
    document.getElementById('playerName').innerText = '-';
}

function recallNextUnsoldPlayer() {

    if (unsoldQueue.length === 0) {

        showAlert('The unsold pool is empty right now.');
        return;
    }

    // Peek only — the player stays in the pool until the auctioneer
    // actually sells them or marks them unsold again. Simply opening
    // the popup and closing it (without picking an option) must not
    // remove them from the pool.
    const nextSl =
        unsoldQueue[0];

    document.getElementById('playerNumber').value = nextSl;

    findPlayer();
}

function recallSpecificUnsoldPlayer(sl) {

    document.getElementById('playerNumber').value = sl;

    findPlayer();
}

function renderUnsoldPool() {

    setTimeout(function () { if (typeof renderAuctionStats === "function") renderAuctionStats(); }, 0);


    const countEl =
        document.getElementById('unsoldCount');

    const listEl =
        document.getElementById('unsoldPoolList');

    if (!countEl || !listEl) return;

    countEl.innerText = unsoldQueue.length;

    if (unsoldQueue.length === 0) {

        listEl.innerHTML =
            '<div class="opacity-50" style="font-size:0.85rem;">No unsold players right now.</div>';
        return;
    }

    listEl.innerHTML =
        unsoldQueue.map(sl => {

            const player =
                players.find(p => p.sl === sl);

            if (!player) return '';

            return `<button type="button" class="unsold-chip" onclick="recallSpecificUnsoldPlayer('${player.sl}')">#${player.sl} - ${player.name}</button>`;

        }).join('');
}

/* =========================================
   GO TO SETUP
========================================= */

function goToSetup() {

    showConfirm(
        'Any unsaved changes on this screen will be kept, but the live auction view will stop.',
        function () {

            document
                .getElementById('auctionScreen')
                .classList.remove('active');

            document
                .getElementById('setupScreen')
                .classList.add('active');
        },
        { title: 'Go back to setup page?' }
    );
}

/* =========================================
   RESET AUCTION
========================================= */

function resetAuction() {

    showConfirm(
        'This clears all teams, players, and sale history. This cannot be undone.',
        function () {

            localStorage.removeItem(
                'auctionData'
            );

            location.reload();
        },
        { title: 'Restart the entire auction?' }
    );
}

/* =========================================
   RENDER SUMMARY
========================================= */

function renderSummary() {

    const summary =
        document.getElementById('teamSummary');

    summary.innerHTML = '';

    teams.forEach((team, index) => {

        const maxBid =
            team.balance -
            ((team.playersRemaining - 1) * team.basePrice);

        const spent =
            team.players.reduce(
                (sum, p) => sum + (Number(p.price) || 0), 0
            );

        const purseTotal =
            (Number(team.balance) || 0) + spent;

        const spentPct =
            purseTotal > 0
                ? Math.min(100, Math.round((spent / purseTotal) * 100))
                : 0;

        const squadTotal =
            team.players.length + team.playersRemaining;

        const isLow =
            team.playersRemaining > 0 &&
            maxBid < team.basePrice;

        let playerHtml = '';

        team.players.forEach(player => {

            playerHtml += `
                <div class="player-row">
                    <div class="player-row-info">
                        <img
                            src="${getPlayerImage(player.sl)}"
                            onerror="this.src='${defaultPlayerImage}'"
                            class="player-list-img" alt="">
                        <div class="min-w-0">
                            <div class="player-row-name"><span class="player-row-sl">#${player.sl}</span>${player.name}</div>
                            <div class="player-row-price">₹ ${player.price}</div>
                        </div>
                    </div>
                    <button class="delete-btn"
                        onclick="removePlayer(${index}, '${player.sl}')"
                        aria-label="Remove ${player.name} from ${team.name}">
                        <i class="fa fa-trash"></i>
                    </button>
                </div>
            `;
        });

        summary.innerHTML += `
            <div class="col-md-6">
                <div class="team-card h-100">

                    <div class="team-card-head">
                        <img
                            src="${team.logo || './images/default/teamDefault.png'}"
                            class="team-logo-preview" alt="">
                        <div class="min-w-0">
                            <h5 class="team-card-name">${team.name}</h5>
                            <div class="team-card-sub">${team.playersRemaining} slot${team.playersRemaining === 1 ? '' : 's'} left</div>
                        </div>
                        <span class="badge-custom">${team.players.length}/${squadTotal}</span>
                    </div>

                    <div class="purse-row">
                        <div>
                            <div class="purse-label">PURSE LEFT</div>
                            <div class="purse-value${isLow ? ' low' : ''}">₹ ${team.balance}</div>
                        </div>
                        <div class="purse-side">
                            Max bid <strong>₹ ${maxBid}</strong><br>
                            Spent <strong>₹ ${spent}</strong>
                        </div>
                    </div>

                    <div class="spend-bar" aria-hidden="true">
                        <div class="spend-fill" style="width:${spentPct}%"></div>
                    </div>

                    <div class="team-roster">
                        ${playerHtml || `<div class="team-empty">No players yet</div>`}
                    </div>

                    <button class="btn btn-outline-light w-100 mt-auto"
                        onclick="printTeam(${index})">
                        <i class="fa fa-print me-2"></i>
                        Print team
                    </button>

                </div>
            </div>
        `;
    });

    renderAuctionStats();
}

/* =========================================
   AUCTION STATS (sold / unsold / remaining)
========================================= */

function renderAuctionStats() {

    const soldEl = document.getElementById('statSold');

    if (!soldEl) return;

    const total = Array.isArray(players) ? players.length : 0;

    const soldCount = teams.reduce(
        (sum, t) => sum + (t.players ? t.players.length : 0), 0
    );

    const unsoldCount = Array.isArray(unsoldQueue) ? unsoldQueue.length : 0;

    const remaining = Math.max(0, total - soldCount - unsoldCount);

    soldEl.textContent = soldCount;
    document.getElementById('statUnsold').textContent = unsoldCount;
    document.getElementById('statRemaining').textContent = remaining;

    const soldPct = total > 0 ? (soldCount / total) * 100 : 0;
    const unsoldPct = total > 0 ? (unsoldCount / total) * 100 : 0;

    document.getElementById('progressSold').style.width = soldPct + '%';
    document.getElementById('progressUnsold').style.width = unsoldPct + '%';
}

/* =========================================
   PRINT TEAM
========================================= */

function printTeam(index) {

    const team =
        teams[index];

    const totalSpent =
        team.players.reduce(
            (sum, player) => sum + Number(player.price || 0),
            0
        );

    const printHtml = `

<html>

<head>

<title>${team.name}</title>

<style>

body{
    font-family:Arial,sans-serif;
    padding:20px;
    color:#111;
}

.header-wrapper{
    position:relative;
    margin-bottom:20px;
}

.app-logo{
    position:absolute;
    left:10px;
    top:10px;
    width:80px;
    height:80px;
    border-radius:50%;
    background:#fff;
    border:2px solid #ddd;
    object-fit:cover;
    z-index:10;
}

.banner{
    width:100%;
    height:130px;
    object-fit:cover;
    border-radius:12px;
    border:2px solid #ddd;
}

.tournament-title{
    text-align:center;
    margin-top:15px;
    font-size:28px;
    font-weight:bold;
}

.team-header{
    display:flex;
    align-items:center;
    gap:20px;
    margin-top:30px;
    margin-bottom:20px;
}

.team-logo{
    width:90px;
    height:90px;
    border-radius:50%;
    border:2px solid #ccc;
    object-fit:cover;
}

.team-name{
    font-size:28px;
    font-weight:bold;
}

.team-info{
    margin-top:10px;
    font-size:18px;
}

table{
    width:100%;
    border-collapse:collapse;
    margin-top:25px;
}

th,
td{
    border:1px solid #ccc;
    padding:10px;
}

th{
    background:#f3f3f3;
    text-align:left;
}

.player-img{
    width:55px;
    height:55px;
    border-radius:50%;
    object-fit:cover;
}

.price-cell{
    font-weight:bold;
    text-align:right;
}

.total-row td{
    font-size:18px;
    font-weight:bold;
    background:#f8f8f8;
}

</style>

</head>

<body>

<div class="header-wrapper">

    <img
        src="./images/mainlogo.png"
        class="app-logo">

    <img
        src="${tournamentBanner}"
        class="banner">

</div>

<div class="tournament-title">

    ${tournamentNameGlobal}

</div>

<div class="team-header">

    <img
        src="${team.logo}"
        class="team-logo">

    <div>

        <div class="team-name">
            ${team.name}
        </div>

        <div class="team-info">
            Remaining Balance :
            ₹ ${team.balance}
        </div>

        <div class="team-info">
            Total Players :
            ${team.players.length}
        </div>

        <div class="team-info">
            Total Spent :
            ₹ ${totalSpent}
        </div>

    </div>

</div>

<table>

<thead>

<tr>
    <th style="width:90px">
        SL No
    </th>

    <th style="width:90px">
        Photo
    </th>

    <th>
        Player Name
    </th>

    <th style="width:140px">
        Sold Price
    </th>
</tr>

</thead>

<tbody>

${team.players.map(player => `

<tr>

<td>
${player.sl}
</td>

<td>

<img
    src="${getPlayerImage(player.sl)}"
    onerror="this.src='${defaultPlayerImage}'"
    class="player-img">

</td>

<td>
${player.name}
</td>

<td class="price-cell">
₹ ${player.price}
</td>

</tr>

`).join('')}

<tr class="total-row">
    <td colspan="3">Total Spent</td>
    <td class="price-cell">₹ ${totalSpent}</td>
</tr>

</tbody>

</table>

</body>

</html>

`;

    const plugin =
        (window.Capacitor && window.Capacitor.Plugins &&
            window.Capacitor.Plugins.PrintService) || null;

    if (plugin) {

        plugin.printHtml({
            html: printHtml,
            jobName: team.name

        }).catch(e => {

            showAlert(
                'Could not open the print dialog: ' + e.message,
                { title: 'Print failed', tone: 'danger' }
            );
        });

        return;
    }

    // Browser preview fallback (no native Print plugin available).
    const printWindow =
        window.open(
            '',
            '',
            'width=900,height=700'
        );

    printWindow.document.write(printHtml);

    printWindow.document.close();

    setTimeout(() => {

        printWindow.print();

    }, 1500);
}

/* =========================================
   LOADER
========================================= */

window.addEventListener('load', function () {

    setTimeout(() => {

        const loader =
            document.getElementById('appLoader');

        loader.style.opacity = '0';

        loader.style.transition =
            '0.6s ease';

        setTimeout(() => {

            loader.style.display = 'none';

        }, 600);

    }, 2500);

});

/* =========================================
   SOLD ANIMATION
========================================= */

function showSoldAnimation(playerName, teamName, price, logo) {

    const soldSound =
        document.getElementById(
            'soldSound'
        );

    if (soldSound) {

        soldSound.currentTime = 0;

        soldSound.play();

    }

    const animation =
        document.getElementById('soldAnimation');

    document
        .getElementById('soldPlayerName')
        .innerText =
        playerName;

    document
        .getElementById('soldTeamName')
        .innerText =
        'Sold To ' + teamName;

    document
        .getElementById('soldPriceText')
        .innerText =
        '₹ ' + price;

    document
        .getElementById('soldTeamLogo')
        .src =
        logo;

    animation.style.display = 'flex';

    setTimeout(() => {

        animation.style.display = 'none';

    }, 2500);
}
function getPlayerImage(slNo) {

    const key =
        String(slNo).trim();

    if (zipPhotos && zipPhotos[key]) {

        return zipPhotos[key];
    }

    if (!playerImageFolder) {

        return defaultPlayerImage;
    }

    let folder =
        playerImageFolder.trim();

    if (!folder.endsWith('/')) {

        folder += '/';
    }

    return folder + slNo + '.jpg';
}
function fileToBase64(file) {

    return new Promise((resolve) => {

        const reader = new FileReader();

        reader.onload = function () {

            resolve(reader.result);

        };

        reader.readAsDataURL(file);

    });

}

document.getElementById('playerNumber')
    .addEventListener('keypress', function (e) {

        if (e.key === 'Enter') {

            findPlayer();
        }

    });

/* =========================================
   OWNER LIVE VIEW (local hotspot server)
========================================= */

function getAuctionServerPlugin() {

    if (
        window.Capacitor &&
        window.Capacitor.Plugins &&
        window.Capacitor.Plugins.AuctionServer
    ) {

        return window.Capacitor.Plugins.AuctionServer;
    }

    return null;
}

function buildStatePayload() {

    return {

        tournamentName: tournamentNameGlobal,

        tournamentBanner,

        lastSold,

        currentPlayer: currentAuctionPlayer,

        teams: teams.map(team => ({

            name: team.name,
            logo: team.logo,
            balance: team.balance,
            maxPrice:
                team.balance -
                ((team.playersRemaining - 1) * team.basePrice),
            playersRemaining: team.playersRemaining,
            players: team.players

        }))

    };
}

function pushStateToLiveServer() {

    const plugin =
        getAuctionServerPlugin();

    if (plugin && liveServerInfo) {

        plugin.updateState({

            data: JSON.stringify(buildStatePayload())

        }).catch(() => {});
    }

    pushStateToFirestore();
}

function showLiveViewInfo() {

    showAlert(
        'Turn on this phone\'s Mobile Hotspot, then tap "Start Live View." ' +
        'A QR code appears — team owners join your hotspot and scan it to ' +
        'see a live, read-only dashboard of every team and player in their ' +
        'own browser. No app install, no internet — everything stays on ' +
        'your local Wi-Fi.',
        { title: 'How Live View works' }
    );
}

async function toggleLiveView() {

    const plugin =
        getAuctionServerPlugin();

    if (!plugin) {

        showAlert(
            'Live View for Owners only works when this app is installed ' +
            'on an Android device — it is not available in a browser ' +
            'preview.'
        );
        return;
    }

    if (liveServerInfo) {

        await plugin.stop();

        liveServerInfo = null;

        document.getElementById('liveViewModalBody').innerHTML =
            '<p class="opacity-75">Live View stopped.</p>';

        document.getElementById('liveViewToggleBtn').innerHTML =
            '<i class="fa fa-wifi me-2"></i><span>Start Live View</span>';

        return;
    }

    try {

        liveServerInfo =
            await plugin.start();

        pushStateToLiveServer();

        renderLiveViewModal();

        document.getElementById('liveViewToggleBtn').innerHTML =
            '<i class="fa fa-wifi me-2"></i><span>Stop Live View</span>';

    } catch (e) {

        showAlert('Could not start Live View: ' + e.message);
    }
}

function renderLiveViewModal() {

    const body =
        document.getElementById('liveViewModalBody');

    body.innerHTML = `

        <div class="text-center mb-3">
            <canvas id="liveViewQr"></canvas>
        </div>

        <p class="text-center mb-1">
            Team owners: connect to this device's Wi-Fi hotspot, then
            scan the QR code above (or open the link below).
        </p>

        <p class="text-center">
            <a href="${liveServerInfo.url}" target="_blank">
                ${liveServerInfo.url}
            </a>
        </p>

        <button class="btn btn-primary-custom w-100" onclick="shareLink('${liveServerInfo.url}', 'Join the live auction view')">
            <i class="fa fa-share-nodes me-2"></i>
            Share Link
        </button>

    `;

    drawQrCode('liveViewQr', liveServerInfo.url);

    const modal =
        new bootstrap.Modal(
            document.getElementById('liveViewModal')
        );

    modal.show();
}

function drawQrCode(canvasId, text) {

    // Uses the bundled qrcode-generator library (./vendor/qrcode.js),
    // which works fully offline.
    const qr =
        qrcode(0, 'M');

    qr.addData(text);
    qr.make();

    const moduleCount =
        qr.getModuleCount();

    const canvas =
        document.getElementById(canvasId);

    const size = 220;

    const scale =
        Math.floor(size / moduleCount);

    canvas.width = moduleCount * scale;
    canvas.height = moduleCount * scale;

    const ctx =
        canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#071120';

    for (let row = 0; row < moduleCount; row++) {

        for (let col = 0; col < moduleCount; col++) {

            if (qr.isDark(row, col)) {

                ctx.fillRect(
                    col * scale,
                    row * scale,
                    scale,
                    scale
                );
            }
        }
    }
}

/* =========================================
   SHARE (used by both Live View and Remote View QR popups)
========================================= */

async function shareLink(url, title) {

    if (navigator.share) {

        try {

            await navigator.share({

                title: title,
                text: title,
                url: url

            });

            return;

        } catch (e) {

            // User cancelled the native share sheet, or it failed —
            // fall through to the clipboard fallback below.
        }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {

        try {

            await navigator.clipboard.writeText(url);

            showAlert('Link copied to clipboard — paste it in WhatsApp, SMS, or anywhere you like.');
            return;

        } catch (e) {

            // Fall through to the manual-copy message below.
        }
    }

    showAlert('Could not share automatically. Please copy this link manually:\n' + url);
}

/* =========================================
   PRO / MONETIZATION GATING
   =========================================
   How this works:
   - isProUser is read from Firestore (users/{uid}.isPro), set by a
     real purchase flow later (see notes in requirePro()).
   - requirePro() is the single gate every paid feature should call
     through — free users see an upgrade prompt instead of the
     feature running.
   - devSetProStatus() is a TESTING-ONLY helper so you can flip Pro
     on/off for your own account while building, without a real
     purchase. Remove the button that calls it before a public
     release, or leave the console function available only to you.
========================================= */

let isProUser = false;

const FREE_TIER_MAX_TEAMS = 4;

async function checkProStatus() {

    if (!firestoreDb || !firebaseUserId) {

        isProUser = false;
        return;
    }

    try {

        const doc =
            await firestoreDb.collection('users').doc(firebaseUserId).get();

        isProUser =
            !!(doc.exists && doc.data().isPro);

    } catch (e) {

        console.error('Could not check Pro status', e);
        isProUser = false;
    }
}

function requirePro(featureLabel, onAllowed) {

    if (isProUser) {

        onAllowed();
        return;
    }

    showConfirm(

        featureLabel + ' is a Pro feature. Upgrade to unlock it for ' +
        'every future auction on this account.',

        function () {

            // TODO: replace this with the real Google Play Billing
            // purchase flow once it's set up (see the monetization
            // conversation — this is intentionally just a placeholder
            // so the rest of the app already behaves correctly once
            // isProUser really can become true).
            showAlert(
                'Purchases aren\'t set up yet — this is a placeholder ' +
                'for where the "Buy Pro" flow will go.'
            );
        },

        { title: 'Upgrade to Pro' }
    );
}

async function devSetProStatus(value) {

    try {

        await ensureFirebaseReady();

    } catch (e) {

        showAlert(e.message);
        return;
    }

    await firestoreDb
        .collection('users')
        .doc(firebaseUserId)
        .set({ isPro: value }, { merge: true });

    isProUser = value;

    showAlert(
        'Pro status set to: ' + value + '. (Dev-only toggle — real ' +
        'purchases will set this through a verified server check later.)'
    );
}

/* =========================================
   REMOTE LIVE VIEW (FIREBASE — over the internet)
   Entirely optional. Loads the Firebase SDK lazily (only when
   this feature is actually used) so the app stays fully offline
   and unaffected unless firebase-config.js has been filled in.
========================================= */

function loadScriptOnce(src) {

    return new Promise((resolve, reject) => {

        if (document.querySelector(`script[src="${src}"]`)) {

            resolve();
            return;
        }

        const script =
            document.createElement('script');

        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load ' + src));

        document.head.appendChild(script);
    });
}

async function ensureFirebaseReady() {

    if (typeof FIREBASE_IS_CONFIGURED === 'undefined' || !FIREBASE_IS_CONFIGURED) {

        throw new Error(
            'Firebase is not set up yet. Fill in www/firebase-config.js ' +
            'with your project\'s details first.'
        );
    }

    if (firestoreDb) {

        return;
    }

    if (!firebaseSdkLoaded) {

        // Loaded from Google's CDN, and only when Remote Live View is
        // actually used — the rest of the app never needs internet.
        await loadScriptOnce('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
        await loadScriptOnce('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js');
        await loadScriptOnce('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js');

        firebaseSdkLoaded = true;
    }

    if (!firebase.apps || !firebase.apps.length) {

        firebase.initializeApp(FIREBASE_CONFIG);
    }

    firestoreDb =
        firebase.firestore();

    if (!firebaseUserId) {

        const credential =
            await firebase.auth().signInAnonymously();

        firebaseUserId =
            credential.user.uid;
    }
}

function generateTournamentId() {

    if (window.crypto && crypto.randomUUID) {

        return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    }

    return (
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 8)
    );
}

async function toggleRemoteLiveView() {

    if (remoteLiveViewActive) {

        remoteLiveViewActive = false;

        document.getElementById('remoteLiveViewToggleBtn').innerHTML =
            '<i class="fa fa-cloud me-2"></i><span>Start Remote View</span>';

        showAlert('Remote Live View stopped. The link/QR code will no longer update.');
        return;
    }

    try {

        await ensureFirebaseReady();

    } catch (e) {

        showAlert(e.message);
        return;
    }

    if (!currentTournamentId) {

        currentTournamentId = generateTournamentId();

        saveAuctionData();
    }

    remoteLiveViewActive = true;

    document.getElementById('remoteLiveViewToggleBtn').innerHTML =
        '<i class="fa fa-cloud me-2"></i><span>Stop Remote View</span>';

    pushStateToFirestore();

    renderRemoteLiveViewModal();
}

function renderRemoteLiveViewModal() {

    const remoteUrl =
        REMOTE_VIEWER_BASE_URL + '?t=' + currentTournamentId;

    const body =
        document.getElementById('liveViewModalBody');

    body.innerHTML = `

        <div class="text-center mb-3">
            <canvas id="remoteViewQr"></canvas>
        </div>

        <p class="text-center mb-1">
            Team owners: open this link from anywhere with internet
            (no need to be on your Wi-Fi/hotspot).
        </p>

        <p class="text-center">
            <a href="${remoteUrl}" target="_blank">
                ${remoteUrl}
            </a>
        </p>

        <button class="btn btn-primary-custom w-100" onclick="shareLink('${remoteUrl}', 'Watch the live auction remotely')">
            <i class="fa fa-share-nodes me-2"></i>
            Share Link
        </button>

        <p class="text-center mt-3 mb-0" id="remoteSyncStatus" style="font-size: 0.85rem;">
        </p>

    `;

    drawQrCode('remoteViewQr', remoteUrl);

    const modal =
        new bootstrap.Modal(
            document.getElementById('liveViewModal')
        );

    modal.show();
}

function pushStateToFirestore() {

    if (!remoteLiveViewActive || !firestoreDb || !currentTournamentId) {

        return;
    }

    // Never push zipPhotos (raw base64 images) to Firestore — it
    // blows past the 1MB-per-document limit fast and burns through
    // the free storage quota for no real benefit. Player photos stay
    // local; only the auction state itself gets synced.
    const payload =
        buildStatePayload();

    firestoreDb
        .collection('tournaments')
        .doc(currentTournamentId)
        .set({

            ...payload,
            ownerId: firebaseUserId,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()

        })
        .then(() => {

            const statusEl =
                document.getElementById('remoteSyncStatus');

            if (statusEl) {

                statusEl.innerText =
                    '✓ Synced ' + new Date().toLocaleTimeString();

                statusEl.style.color = '#4ade80';
            }
        })
        .catch(err => {

            console.error('Firestore sync failed', err);

            const statusEl =
                document.getElementById('remoteSyncStatus');

            if (statusEl) {

                statusEl.innerText =
                    '⚠ Not syncing — check your internet connection.';

                statusEl.style.color = '#f87171';
            }
        });
}

/* =========================================
   PLAYER PHOTOS VIA ZIP UPLOAD
========================================= */

async function handlePlayerZipUpload(fileInput) {

    const file =
        fileInput.files[0];

    if (!file) return;

    const statusEl =
        document.getElementById('zipUploadStatus');

    statusEl.innerText = 'Reading ZIP file…';

    try {

        const zip =
            await JSZip.loadAsync(file);

        let count = 0;

        const entries =
            Object.values(zip.files)
                .filter(entry => !entry.dir);

        for (const entry of entries) {

            const fileName =
                entry.name.split('/').pop();

            const match =
                fileName.match(/^(\d+)\.(jpg|jpeg|png|webp)$/i);

            if (!match) continue;

            const sl =
                match[1];

            const blob =
                await entry.async('blob');

            let base64;

            try {

                base64 =
                    await compressImageBlob(blob);

            } catch (e) {

                // Fall back to the original if compression fails for
                // some reason (e.g. an unusual file format).
                base64 =
                    await blobToBase64(blob);
            }

            zipPhotos[sl] = base64;

            count++;
        }

        statusEl.innerText =
            count > 0 ?
                `Loaded ${count} player photo(s) from ZIP (compressed to save space).` :
                'No matching photos found. Name files like "12.jpg" using the player SL number.';

        saveAuctionData();

        if (typeof renderSummary === 'function' && teams.length > 0) {

            renderSummary();
        }

    } catch (e) {

        statusEl.innerText = 'Could not read ZIP file: ' + e.message;
    }
}

function blobToBase64(blob) {

    return new Promise((resolve) => {

        const reader = new FileReader();

        reader.onload = function () {

            resolve(reader.result);
        };

        reader.readAsDataURL(blob);
    });
}

/**
 * Shrinks a player photo down to a sensible size before it's stored.
 * Full-resolution phone camera photos (often 3-8MB each) blow past
 * the browser's local storage quota once you have dozens of players —
 * that's what causes the "device storage is full" error. Resizing to
 * a small square JPEG cuts a typical photo from megabytes down to
 * roughly 20-60KB, so even 100+ player photos comfortably fit.
 */
function compressImageBlob(blob, maxDimension = 480, quality = 0.72) {

    return new Promise((resolve, reject) => {

        const img = new Image();

        const objectUrl =
            URL.createObjectURL(blob);

        img.onload = function () {

            URL.revokeObjectURL(objectUrl);

            let { width, height } = img;

            if (width > height && width > maxDimension) {

                height = Math.round(height * (maxDimension / width));
                width = maxDimension;

            } else if (height > maxDimension) {

                width = Math.round(width * (maxDimension / height));
                height = maxDimension;
            }

            const canvas =
                document.createElement('canvas');

            canvas.width = width;
            canvas.height = height;

            canvas.getContext('2d').drawImage(img, 0, 0, width, height);

            resolve(canvas.toDataURL('image/jpeg', quality));
        };

        img.onerror = function () {

            URL.revokeObjectURL(objectUrl);
            reject(new Error('Could not read image'));
        };

        img.src = objectUrl;
    });
}

function togglePhotoMethod() {

    const method =
        document.querySelector('input[name="photoMethod"]:checked').value;

    document.getElementById('photoZipSection').classList.toggle(
        'd-none', method !== 'zip'
    );

    document.getElementById('photoUrlSection').classList.toggle(
        'd-none', method !== 'url'
    );
}