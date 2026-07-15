/**
 * FIREBASE CONFIGURATION
 * =========================================================
 * Fill in the values below with YOUR OWN Firebase project's
 * settings, and Remote Live View will work. Until you do, the
 * app keeps working exactly as before — local, offline,
 * hotspot-based Live View is completely unaffected.
 *
 * Where to get these values:
 *   1. Go to https://console.firebase.google.com and create a
 *      free project (or use an existing one).
 *   2. In that project, click "Add app" -> the </> (Web) icon.
 *   3. Register the app (any nickname is fine, no Hosting setup
 *      needed at this step).
 *   4. Firebase shows you a `firebaseConfig` object — copy each
 *      value into the matching field below.
 *   5. In the Firebase console, also turn on:
 *        - Build -> Firestore Database -> Create database
 *        - Build -> Authentication -> Sign-in method -> Anonymous -> Enable
 * =========================================================
 */

const FIREBASE_CONFIG = {

    apiKey: "AIzaSyCWgU5y2mxoIWG0JTlPWW2pTOFVucgFvVE",
    authDomain: "auctionx-viewer.firebaseapp.com",
    projectId: "auctionx-viewer",
    storageBucket: "auctionx-viewer.firebasestorage.app",
    messagingSenderId: "492065437613",
    appId: "1:492065437613:web:3e4f00a5c38e8de80a9324"

};

const REMOTE_VIEWER_BASE_URL = "https://auctionx-viewer.web.app";

const FIREBASE_IS_CONFIGURED =
    FIREBASE_CONFIG.apiKey.indexOf("REPLACE_WITH") === -1;
