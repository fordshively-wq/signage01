const firebaseState = {
  enabled: false,
  auth: null,
  ready: initFirebaseAuth()
};

async function initFirebaseAuth() {
  const response = await fetch("/api/firebase-config");
  const { enabled, config } = await response.json();
  if (!enabled) return false;
  const [{ initializeApp }, authModule] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js")
  ]);
  const app = initializeApp(config);
  firebaseState.auth = authModule.getAuth(app);
  firebaseState.authModule = authModule;
  firebaseState.enabled = true;
  return true;
}

async function firebaseEmailRegister(email, password, name) {
  await firebaseState.ready;
  const { createUserWithEmailAndPassword, updateProfile } = firebaseState.authModule;
  const credential = await createUserWithEmailAndPassword(firebaseState.auth, email, password);
  if (name) await updateProfile(credential.user, { displayName: name });
  return createServerSession(credential.user, name);
}

async function firebaseEmailLogin(email, password) {
  await firebaseState.ready;
  const { signInWithEmailAndPassword } = firebaseState.authModule;
  const credential = await signInWithEmailAndPassword(firebaseState.auth, email, password);
  return createServerSession(credential.user);
}

async function firebaseGoogleLogin() {
  await firebaseState.ready;
  const { GoogleAuthProvider, signInWithPopup } = firebaseState.authModule;
  const provider = new GoogleAuthProvider();
  const credential = await signInWithPopup(firebaseState.auth, provider);
  return createServerSession(credential.user);
}

async function firebaseLogout() {
  await firebaseState.ready;
  if (!firebaseState.enabled) return;
  await firebaseState.authModule.signOut(firebaseState.auth);
}

async function createServerSession(user, name = "") {
  const idToken = await user.getIdToken();
  const response = await fetch("/api/auth/firebase-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, name, email: user.email })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Firebase sign-in failed.");
  return data;
}

window.signalFirebase = {
  get enabled() {
    return firebaseState.enabled;
  },
  ready: firebaseState.ready,
  register: firebaseEmailRegister,
  login: firebaseEmailLogin,
  google: firebaseGoogleLogin,
  logout: firebaseLogout
};
