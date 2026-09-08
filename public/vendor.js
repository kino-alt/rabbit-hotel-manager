// Firebase SDK の唯一の入口。
// バージョンを上げるときは、このファイルの URL（4行）だけを直す。
// 他のモジュールは "./vendor.js" から import する（gstatic の URL を直に書かない）。

export { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

export {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

export {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  deleteField,
  Timestamp,
  runTransaction,
  arrayUnion,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js";
