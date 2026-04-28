import { db, auth } from './firebase.js';

import {
  collection,
  addDoc,
  onSnapshot,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

window.logout = async function () {
  try {
    await signOut(auth);
    alert("Logged out successfully");
    window.location.href = "index.html";
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
};

// ==========================
// NAVIGATION
// ==========================
window.showSection = function(sectionId) {
  document.querySelectorAll(".section").forEach(sec => {
    sec.classList.remove("active");
  });
  document.getElementById(sectionId).classList.add("active");
};

// ==========================
// CREATE EVENT
// ==========================
window.createEvent = async function () {
  const name = document.getElementById("eventName").value;

  const user = auth.currentUser;

  if (!name) return alert("Enter event name");
  if (!user) return alert("Not logged in");

  await addDoc(collection(db, "events"), {
    name: name,
    createdBy: user.email,
    date: new Date()
  });

  notify("Event created!");
};

// ==========================
// REAL-TIME EVENTS (Pub/Sub)
// ==========================
const eventList = document.getElementById("eventList");

if (eventList) {
  onSnapshot(collection(db, "events"), snapshot => {
    eventList.innerHTML = "";

    snapshot.forEach(doc => {
      let div = document.createElement("div");
      div.className = "item";
      div.textContent = doc.data().name;
      eventList.appendChild(div);
    });
  });
}

// ==========================
// CREATE TASK
// ==========================
window.createTask = async function () {
  const title = document.getElementById("taskName").value;
  const eventId = document.getElementById("eventId").value;

  const user = auth.currentUser;

  if (!title) return alert("Enter task name");

  await addDoc(collection(db, "tasks"), {
    title: title,
    eventId: eventId,
    assignedTo: user.email,
    status: "Pending"
  });

  notify("Task created!");
};

// ==========================
// REAL-TIME TASKS
// ==========================
const taskList = document.getElementById("taskList");

if (taskList) {
  onSnapshot(collection(db, "tasks"), snapshot => {
    taskList.innerHTML = "";

    snapshot.forEach(doc => {
      let div = document.createElement("div");
      div.className = "item";
      div.textContent = doc.data().title;
      taskList.appendChild(div);
    });
  });
}

// ==========================
// NOTIFICATIONS (Pub/Sub SIM)
// ==========================
const notifList = document.getElementById("notifList");

// REAL-TIME NOTIFICATIONS (Pub/Sub)
onSnapshot(collection(db, "notifications"), (snapshot) => {
  notifList.innerHTML = "";

  snapshot.forEach(doc => {
    const data = doc.data();

    let li = document.createElement("li");
    li.textContent = data.message;

    notifList.appendChild(li);
  });
});

window.notify = async function (message) {
  const user = auth.currentUser;

  await addDoc(collection(db, "notifications"), {
    userId: user.email,
    message: message,
    createdAt: new Date(),
    read: false
  });
};

// ==========================
// 🔐 LOGIN
// ==========================
window.login = async function () {
  const email = document.getElementById("email")?.value;
  const password = document.getElementById("password")?.value;

  if (!email || !password) {
    return alert("Enter email and password");
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    alert("Login successful!");
    window.location.href = "dashboard.html";
  } catch (error) {
    alert(error.message);
  }
};

// ==========================
// 📝 REGISTER
// ==========================

window.register = async function () {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    await createUserWithEmailAndPassword(auth, email, password);
    alert("Registered successfully!");
  } catch (error) {
    console.error(error);
    alert(error.message);
  }
};

// ==========================
// 🔄 AUTH STATE CHECK
// ==========================
onAuthStateChanged(auth, (user) => {
  const isDashboard = window.location.pathname.includes("dashboard.html");

  if (!user && isDashboard) {
    alert("You must login first!");
    window.location.href = "index.html";
  }

  if (user) {
    console.log("Logged in as:", user.email);
  }
});

document.addEventListener("DOMContentLoaded", function () {

  const calendarEl = document.getElementById("calendar");

  if (!calendarEl) return;

  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: "dayGridMonth",
    selectable: true,

    // 📌 CLICK DATE → CREATE EVENT
    dateClick: function(info) {
      const eventName = prompt("Enter event name:");

      if (eventName) {
        addDoc(collection(db, "events"), {
          name: eventName,
          date: info.dateStr
        });
      }
    },

    // 📌 LOAD EVENTS
    events: async function(fetchInfo, successCallback) {
      const snapshot = await getDocs(collection(db, "events"));

      let events = [];

      snapshot.forEach(doc => {
        const data = doc.data();

        events.push({
          title: data.name,
          start: data.date
        });
      });

      successCallback(events);
    }
  });

  calendar.render();
});


onAuthStateChanged(auth, (user) => {
  if (user) {
    const emailDisplay = document.getElementById("userEmail");

    if (emailDisplay) {
      emailDisplay.textContent = user.email;
    }
  }
});

//PROFILE
// ==========================
window.updateProfile = async function () {
  const name = document.getElementById("name").value;
  const user = auth.currentUser;

  if (!user) return;

  await setDoc(doc(db, "users", user.uid), {
    email: user.email,
    name: name,
    role: "organizer"
  });

  alert("Profile updated!");
};

onSnapshot(collection(db, "events"), (snapshot) => {
  const eventList = document.getElementById("eventList");
  eventList.innerHTML = "";

  snapshot.forEach(doc => {
    let div = document.createElement("div");
    div.textContent = doc.data().name;
    eventList.appendChild(div);
  });
});