import {
  firebaseConfig,
  firebaseConfigured
} from "./firebase-config.js";

const FIREBASE_VERSION = "12.18.0";
const FIREBASE_CDN =
  `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

const STATION_ID = "demo-station";
export const ADMIN_UID = "fM6p0sQzQbaqKAmuQFGA6mNolJU2";

let authSdk;
let databaseSdk;
let auth;
let database;
let currentUser;

export function normalizeUid(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "")
    .match(/.{1,2}/g)
    ?.join(" ") || "";
}

function uidKey(value) {
  return normalizeUid(value).replaceAll(" ", "-");
}

function snapshotList(snapshot) {
  const value = snapshot.val() || {};

  return Object.entries(value).map(([id, item]) => ({
    id,
    ...item
  }));
}

function requireConnection() {
  if (!database || !currentUser) {
    throw new Error("Firebase is not connected.");
  }
}

function requireAuth() {
  if (!auth || !authSdk) {
    throw new Error("Firebase Authentication is not connected.");
  }
}

function authState(user = currentUser) {
  return {
    uid: user?.uid || "",
    email: user?.email || "",
    isAnonymous: Boolean(user?.isAnonymous),
    isAdmin: user?.uid === ADMIN_UID
  };
}

function waitForInitialAuthState() {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};

    unsubscribe = authSdk.onAuthStateChanged(
      auth,
      user => {
        unsubscribe();
        resolve(user);
      },
      reject
    );
  });
}

export async function connectFirebase() {
  if (!firebaseConfigured) {
    return {
      connected: false,
      reason: "Firebase configuration has not been added yet."
    };
  }

  const [appSdk, loadedAuthSdk, loadedDatabaseSdk] =
    await Promise.all([
      import(`${FIREBASE_CDN}/firebase-app.js`),
      import(`${FIREBASE_CDN}/firebase-auth.js`),
      import(`${FIREBASE_CDN}/firebase-database.js`)
    ]);

  authSdk = loadedAuthSdk;
  databaseSdk = loadedDatabaseSdk;

  const app = appSdk.initializeApp(firebaseConfig);

  auth = authSdk.getAuth(app);
  database = databaseSdk.getDatabase(app);

  await authSdk.setPersistence(
    auth,
    authSdk.browserLocalPersistence
  );

  currentUser = await waitForInitialAuthState();

  if (!currentUser) {
    const credential = await authSdk.signInAnonymously(auth);
    currentUser = credential.user;
  }

  return {
    connected: true,
    ...authState()
  };
}

export function subscribeAuthState(callback, errorCallback) {
  requireAuth();

  return authSdk.onAuthStateChanged(
    auth,
    user => {
      currentUser = user;
      callback(authState(user));
    },
    errorCallback
  );
}

export async function signInAdmin(email, password) {
  requireAuth();

  const normalizedEmail = String(email || "").trim();
  const normalizedPassword = String(password || "");

  if (!normalizedEmail || !normalizedPassword) {
    throw new Error("Admin email and password are required.");
  }

  const credential = await authSdk.signInWithEmailAndPassword(
    auth,
    normalizedEmail,
    normalizedPassword
  );

  if (credential.user.uid !== ADMIN_UID) {
    await authSdk.signOut(auth);
    const anonymousCredential =
      await authSdk.signInAnonymously(auth);
    currentUser = anonymousCredential.user;
    throw new Error("This account is not authorized as the project admin.");
  }

  currentUser = credential.user;
  return authState();
}

export async function signOutAdmin() {
  requireAuth();

  await authSdk.signOut(auth);

  const credential = await authSdk.signInAnonymously(auth);
  currentUser = credential.user;

  return authState();
}

export function subscribeBookings(callback, errorCallback) {
  requireConnection();

  return databaseSdk.onValue(
    databaseSdk.ref(database, "bookings"),
    snapshot => callback(snapshotList(snapshot)),
    errorCallback
  );
}

export async function createBooking(booking) {
  requireConnection();

  const bookingRef = databaseSdk.push(
    databaseSdk.ref(database, "bookings")
  );

  await databaseSdk.set(bookingRef, {
    ...booking,
    uid: normalizeUid(booking.uid),
    createdAt: databaseSdk.serverTimestamp(),
    createdBy: currentUser.uid,
    status: "confirmed"
  });
}

export async function deleteBooking(id) {
  requireConnection();

  await databaseSdk.remove(
    databaseSdk.ref(database, `bookings/${id}`)
  );
}

export async function deleteAllBookings() {
  requireConnection();

  await databaseSdk.remove(
    databaseSdk.ref(database, "bookings")
  );
}

export function subscribeRfidUsers(callback, errorCallback) {
  requireConnection();

  return databaseSdk.onValue(
    databaseSdk.ref(database, "rfidUsers"),
    snapshot => callback(snapshotList(snapshot)),
    errorCallback
  );
}

export async function saveRfidUser(user) {
  requireConnection();

  const normalizedUid = normalizeUid(user.uid);
  const key = uidKey(normalizedUid);

  if (!key) {
    throw new Error("RFID UID is required.");
  }

  await databaseSdk.set(
    databaseSdk.ref(database, `rfidUsers/${key}`),
    {
      ...user,
      uid: normalizedUid,
      active: true,
      updatedAt: databaseSdk.serverTimestamp(),
      updatedBy: currentUser.uid
    }
  );
}

export async function deleteRfidUser(id) {
  requireConnection();

  await databaseSdk.remove(
    databaseSdk.ref(database, `rfidUsers/${id}`)
  );
}

export async function deleteAllRfidUsers() {
  requireConnection();

  await databaseSdk.remove(
    databaseSdk.ref(database, "rfidUsers")
  );
}

export async function recordAccessEvent({
  uid,
  granted,
  userName = "",
  plate = "",
  source = "website"
}) {
  requireConnection();

  const eventRef = databaseSdk.push(
    databaseSdk.ref(database, "accessEvents")
  );

  await databaseSdk.set(eventRef, {
    uid: normalizeUid(uid),
    granted,
    userName,
    plate,
    source,
    timestamp: databaseSdk.serverTimestamp(),
    createdBy: currentUser.uid
  });
}

export function subscribeStation(callback, errorCallback) {
  requireConnection();

  return databaseSdk.onValue(
    databaseSdk.ref(
      database,
      `stations/${STATION_ID}`
    ),
    snapshot => callback(snapshot.val() || {}),
    errorCallback
  );
}
