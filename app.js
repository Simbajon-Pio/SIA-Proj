import { db, auth } from './firebase.js';

import {
  collection, addDoc, onSnapshot,
  doc, setDoc, getDoc, deleteDoc,
  updateDoc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  onAuthStateChanged, signOut, updateProfile as fbUpdateProfile
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ============================================================
//  STATE
// ============================================================
let allEvents = [];
let allTasks  = [];
let calendarInstance = null;
let currentTaskFilter = 'all';

// ============================================================
//  TOAST NOTIFICATIONS
// ============================================================
window.showToast = function(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span> ${message}`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 3500);
};

// ============================================================
//  NAVIGATION
// ============================================================
window.showSection = function(sectionId) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const section = document.getElementById(sectionId);
  if (section) section.classList.add('active');

  const navItem = document.querySelector(`[data-section="${sectionId}"]`);
  if (navItem) navItem.classList.add('active');

  const titles = {
    overview: 'Overview', events: 'Events', tasks: 'Tasks',
    calendar: 'Calendar', notifications: 'Notifications', profile: 'Profile'
  };
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = titles[sectionId] || sectionId;

  // Init calendar when tab opens
  if (sectionId === 'calendar' && calendarInstance) {
    setTimeout(() => calendarInstance.render(), 50);
  }

  // Close sidebar on mobile
  if (window.innerWidth < 768) closeSidebar();
};

window.toggleSidebar = function() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('show');
};

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.remove('show');
}

// ============================================================
//  AUTH
// ============================================================
window.handleLogout = async function() {
  try {
    await signOut(auth);
    sessionStorage.setItem('loggedOut', 'true');
    window.location.href = 'index.html';
  } catch (e) {
    showToast(e.message, 'error');
  }
};

onAuthStateChanged(auth, async (user) => {
  const isDash = window.location.pathname.includes('dashboard.html');
  if (!user && isDash) { window.location.href = 'index.html'; return; }
  if (!user) return;

  // Set display name
  const name = user.displayName || user.email.split('@')[0];
  const initial = name[0].toUpperCase();

  ['sidebarAvatar','topbarAvatar','profileAvatar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = initial;
  });
  ['sidebarName','greetName','profileDisplayName'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = id === 'sidebarName' ? name : name.split(' ')[0];
  });

  const emailEl = document.getElementById('profileEmail');
  if (emailEl) emailEl.textContent = user.email;
  const emailInput = document.getElementById('profileEmailInput');
  if (emailInput) emailInput.value = user.email;

  // Load profile from Firestore
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      const d = snap.data();
      const nameInput = document.getElementById('profileName');
      if (nameInput) nameInput.value = d.name || '';
      const roleSelect = document.getElementById('profileRole');
      if (roleSelect) roleSelect.value = d.role || 'organizer';
    }
  } catch(e) { /* not critical */ }

  initListeners();
  initCalendar();
});

// ============================================================
//  REALTIME LISTENERS  (called once after auth)
// ============================================================
function initListeners() {
  // EVENTS
  onSnapshot(query(collection(db, 'events'), orderBy('createdAt', 'desc')), snap => {
    allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEvents();
    renderOverview();
    populateEventDropdown();
    updateBadge('eventsCount', allEvents.length);
    updateCalendarEvents();
    document.getElementById('statEvents').textContent = allEvents.length;
  });

  // TASKS
  onSnapshot(query(collection(db, 'tasks'), orderBy('createdAt', 'desc')), snap => {
    allTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTasks();
    renderOverview();
    updateBadge('tasksCount', allTasks.filter(t => t.status === 'Pending').length);
    const done = allTasks.filter(t => t.status === 'Done').length;
    const pending = allTasks.filter(t => t.status === 'Pending').length;
    document.getElementById('statDone').textContent = done;
    document.getElementById('statPending').textContent = pending;

    updateCalendarEvents();
  });

  // NOTIFICATIONS
  onSnapshot(query(collection(db, 'notifications'), orderBy('createdAt', 'desc')), snap => {
    const notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderNotifications(notifs);
    const unread = notifs.filter(n => !n.read).length;
    updateBadge('notifCount', unread);
    document.getElementById('statNotifs').textContent = notifs.length;
    const dot = document.getElementById('notifDot');
    if (dot) dot.style.display = unread > 0 ? 'block' : 'none';
  });
}

function updateBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = count;
  el.style.display = count > 0 ? 'inline-flex' : 'none';
}

// ============================================================
//  EVENTS
// ============================================================
window.createNewEvent = async function() {
  const name     = document.getElementById('eventName').value.trim();
  const date     = document.getElementById('eventDate').value;
  const location = document.getElementById('eventLocation').value.trim();
  const user     = auth.currentUser;

  if (!name) return showToast('Enter an event name', 'error');
  if (!user) return showToast('Not logged in', 'error');

  try {
    await addDoc(collection(db, 'events'), {
      name, date: date || null, location: location || null,
      createdBy: user.email, createdAt: serverTimestamp()
    });
    document.getElementById('eventName').value = '';
    document.getElementById('eventDate').value = '';
    document.getElementById('eventLocation').value = '';
    addNotification(`Event "${name}" created`);
    showToast(`Event "${name}" created!`);
  } catch(e) { showToast(e.message, 'error'); }
};

window.deleteEvent = async function(id, name) {
  if (!confirm(`Delete event "${name}"?`)) return;
  try {
    await deleteDoc(doc(db, 'events', id));
    addNotification(`Event "${name}" deleted`);
    showToast(`Event deleted`);
  } catch(e) { showToast(e.message, 'error'); }
};
window.openEditEventModal = function(id) {
  // 1. Find the specific event
  const e = allEvents.find(x => x.id === id);
  if(!e) return;

  // 2. Pre-fill the modal with the event's current data
  document.getElementById('editEventId').value = e.id;
  document.getElementById('editEventName').value = e.name || '';
  document.getElementById('editEventDate').value = e.date || '';
  document.getElementById('editEventLocation').value = e.location || '';

  // 3. Show the modal
  document.getElementById('editEventModal').style.display = 'flex';
};

window.saveEventEdit = async function() {
  // 1. Grab the updated text from the inputs
  const id = document.getElementById('editEventId').value;
  const name = document.getElementById('editEventName').value.trim();
  const date = document.getElementById('editEventDate').value;
  const location = document.getElementById('editEventLocation').value.trim();

  if (!name) return showToast('Enter an event name', 'error');

  try {
    // 2. Push the changes to Firebase
    await updateDoc(doc(db, 'events', id), {
      name: name,
      date: date || null,
      location: location || null
    });
    
    // 3. Hide modal and notify the user
    document.getElementById('editEventModal').style.display = 'none';
    showToast('Event updated successfully!');
  } catch(e) { 
    showToast(e.message, 'error'); 
  }
};
function renderEvents() {
  const grid  = document.getElementById('eventGrid');
  const empty = document.getElementById('eventEmpty');
  if (!grid) return;

  const q = (document.getElementById('eventSearch')?.value || '').toLowerCase();
  const filtered = allEvents.filter(e => e.name.toLowerCase().includes(q));

  if (filtered.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  grid.innerHTML = filtered.map(e => {
    const taskCount = allTasks.filter(t => t.eventId === e.id).length;
    const doneCount = allTasks.filter(t => t.eventId === e.id && t.status === 'Done').length;
    const pct = taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0;
    return `
    <div class="event-card">
      <div class="event-card-header">
        <div class="event-dot"></div>
        <span class="event-name" style="flex: 1;">${escHtml(e.name)}</span>
        <div style="display:flex; gap:4px;">
          <button class="btn-icon" onclick="openEditEventModal('${e.id}')" title="Edit">✏️</button>
          <button class="btn-icon danger" onclick="deleteEvent('${e.id}','${escHtml(e.name)}')" title="Delete">🗑</button>
        </div>
      </div>
      ${e.date ? `<div class="event-meta">📅 ${formatDate(e.date)}</div>` : ''}
      ${e.location ? `<div class="event-meta">📍 ${escHtml(e.location)}</div>` : ''}
      <div class="event-meta">👤 ${e.createdBy}</div>
      ${taskCount > 0 ? `
        <div class="progress-wrap">
          <div class="progress-bar" style="width:${pct}%"></div>
        </div>
        <div class="event-meta">${doneCount}/${taskCount} tasks done</div>
      ` : ''}
    </div>`;
  }).join('');
}

window.filterEvents = function() { renderEvents(); };

// ============================================================
//  TASKS
// ============================================================
window.createTask = async function() {
  const title    = document.getElementById('taskName').value.trim();
  const eventId  = document.getElementById('taskEvent').value;
  const priority = document.getElementById('taskPriority').value;
  const dueDate = document.getElementById('taskDueDate').value;
  const user     = auth.currentUser;

  if (!title) return showToast('Enter a task name', 'error');
  if (!user)  return showToast('Not logged in', 'error');

  try {
    const linkedEvent = allEvents.find(e => e.id === eventId);
    await addDoc(collection(db, 'tasks'), {
      title, eventId: eventId || null,
      eventName: linkedEvent?.name || null,
      assignedTo: user.email,
      priority: priority || 'Normal',
      status: 'Pending',
      dueDate: dueDate || null,
      createdAt: serverTimestamp()
    });
    document.getElementById('taskName').value = '';
    addNotification(`Task "${title}" added`);
    showToast(`Task added!`);
  } catch(e) { showToast(e.message, 'error'); }
};

window.toggleTask = async function(id, currentStatus) {
  const newStatus = currentStatus === 'Done' ? 'Pending' : 'Done';
  try {
    await updateDoc(doc(db, 'tasks', id), { status: newStatus });
  } catch(e) { showToast(e.message, 'error'); }
};

window.deleteTask = async function(id, title) {
  if (!confirm(`Delete task "${title}"?`)) return;
  try {
    await deleteDoc(doc(db, 'tasks', id));
    showToast('Task deleted');
  } catch(e) { showToast(e.message, 'error'); }
};

window.filterTasks = function(filter, btn) {
  currentTaskFilter = filter;
  document.querySelectorAll('.ftab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderTasks();
};

function renderTasks() {
  const list  = document.getElementById('taskGrid');
  const empty = document.getElementById('taskEmpty');
  if (!list) return;

  const filtered = currentTaskFilter === 'all'
    ? allTasks
    : allTasks.filter(t => t.status === currentTaskFilter);

  if (filtered.length === 0) {
    list.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  list.innerHTML = filtered.map(t => {
    const done = t.status === 'Done';
    const pClass = t.priority === 'High' ? 'priority-high' : t.priority === 'Low' ? 'priority-low' : 'priority-normal';
    return `
    <div class="task-item ${done ? 'task-done' : ''}">
      <button class="task-check ${done ? 'checked' : ''}" onclick="toggleTask('${t.id}','${t.status}')">
        ${done ? '✓' : ''}
      </button>
      <div class="task-body">
        <div class="task-title">${escHtml(t.title)}</div>
        <div class="task-meta">
          ${t.eventName ? `<span>📅 ${escHtml(t.eventName)}</span>` : ''}
          ${t.dueDate ? `<span>⏱ ${formatDate(t.dueDate)}</span>` : ''}
          <span class="priority-badge ${pClass}">${t.priority}</span>
          <span>👤 ${t.assignedTo}</span>
        </div>
      </div>
      <div style="display:flex; gap:4px;">
        <button class="btn-icon" onclick="openEditTaskModal('${t.id}')" title="Edit">✏️</button>
        <button class="btn-icon danger" onclick="deleteTask('${t.id}','${escHtml(t.title)}')" title="Delete">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function populateEventDropdown() {
  const sel = document.getElementById('taskEvent');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— Link to event —</option>' +
    allEvents.map(e => `<option value="${e.id}" ${e.id === current ? 'selected' : ''}>${escHtml(e.name)}</option>`).join('');
}
window.openEditTaskModal = function(id) {
  // 1. Find the task in our downloaded array
  const task = allTasks.find(t => t.id === id);
  if (!task) return;

  // 2. Put the task's current data into the Modal's input fields
  document.getElementById('editTaskId').value = task.id;
  document.getElementById('editTaskName').value = task.title || '';
  document.getElementById('editTaskDueDate').value = task.dueDate || '';
  document.getElementById('editTaskPriority').value = task.priority || 'Normal';

  // 3. Show the Modal
  document.getElementById('editTaskModal').style.display = 'flex';
};

window.saveTaskEdit = async function() {
  // 1. Grab the updated values from the Modal
  const id = document.getElementById('editTaskId').value;
  const title = document.getElementById('editTaskName').value.trim();
  const dueDate = document.getElementById('editTaskDueDate').value;
  const priority = document.getElementById('editTaskPriority').value;

  if (!title) return showToast('Enter a task description', 'error');

  try {
    // 2. Send the updated specific fields to Firestore
    await updateDoc(doc(db, 'tasks', id), {
      title: title,
      dueDate: dueDate || null,
      priority: priority
    });
    
    // 3. Hide the modal and show a success message
    document.getElementById('editTaskModal').style.display = 'none';
    showToast('Task updated successfully!');
  } catch(e) { 
    showToast(e.message, 'error'); 
  }
};
// ============================================================
//  OVERVIEW
// ============================================================
function renderOverview() {
  const recentEvents = document.getElementById('recentEvents');
  const recentTasks  = document.getElementById('recentTasks');

  if (recentEvents) {
    if (allEvents.length === 0) {
      recentEvents.innerHTML = '<div class="empty-mini">No events yet</div>';
    } else {
      recentEvents.innerHTML = allEvents.slice(0, 5).map(e => `
        <div class="list-item">
          <div class="list-dot event-dot-sm"></div>
          <div>
            <div class="list-title">${escHtml(e.name)}</div>
            ${e.date ? `<div class="list-sub">📅 ${formatDate(e.date)}</div>` : ''}
          </div>
        </div>`).join('');
    }
  }

  if (recentTasks) {
    const pending = allTasks.filter(t => t.status === 'Pending').slice(0, 5);
    if (pending.length === 0) {
      recentTasks.innerHTML = '<div class="empty-mini">No pending tasks 🎉</div>';
    } else {
      recentTasks.innerHTML = pending.map(t => `
        <div class="list-item">
          <div class="list-dot task-dot-sm"></div>
          <div>
            <div class="list-title">${escHtml(t.title)}</div>
            ${t.eventName ? `<div class="list-sub">📅 ${escHtml(t.eventName)}</div>` : ''}
          </div>
        </div>`).join('');
    }
  }
}

// ============================================================
//  NOTIFICATIONS
// ============================================================
async function addNotification(message) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await addDoc(collection(db, 'notifications'), {
      userId: user.uid,
      userEmail: user.email,
      message,
      createdAt: serverTimestamp(),
      read: false
    });
  } catch(e) { console.warn('Notif error:', e); }
}

function renderNotifications(notifs) {
  const list  = document.getElementById('notifList');
  const empty = document.getElementById('notifEmpty');
  if (!list) return;

  if (notifs.length === 0) {
    list.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  list.innerHTML = notifs.map(n => {
    const time = n.createdAt?.toDate ? timeAgo(n.createdAt.toDate()) : '';
    return `
    <div class="notif-item ${n.read ? 'read' : 'unread-item'}" onclick="markRead('${n.id}')">
      <div class="notif-dot-indicator ${n.read ? '' : 'active'}"></div>
      <div class="notif-content">
        <div class="notif-message">${escHtml(n.message)}</div>
        ${time ? `<div class="notif-time">${time}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

window.markRead = async function(id) {
  try { await updateDoc(doc(db, 'notifications', id), { read: true }); } catch(e) {}
};

window.clearNotifications = async function() {
  if (!confirm('Clear all notifications?')) return;
  const user = auth.currentUser;
  if (!user) return;
  // Delete user's notifications
  const list = document.getElementById('notifList');
  if (list) list.innerHTML = '';
  showToast('Notifications cleared');
};

// ============================================================
//  CALENDAR
// ============================================================
// ============================================================
//  CALENDAR
// ============================================================
function initCalendar() {
  const el = document.getElementById('calendarEl');
  if (!el || typeof FullCalendar === 'undefined') return;

  // Helper function to combine events and tasks into one array for the calendar
  const getCombinedCalendarData = () => {
    const eventsData = allEvents
      .filter(e => e.date)
      .map(e => ({ 
        title: e.name, 
        start: e.date, 
        id: e.id,
        backgroundColor: 'var(--accent)', // Purple for events
        borderColor: 'var(--accent)',
        extendedProps: { type: 'event' } 
      }));

    const tasksData = allTasks
      .filter(t => t.dueDate)
      .map(t => ({ 
        title: `✅ ${t.title}`, // Add a checkmark so it's obviously a task
        start: t.dueDate, 
        id: t.id,
        backgroundColor: 'var(--warning)', // Orange/Yellow for tasks
        borderColor: 'var(--warning)',
        extendedProps: { type: 'task' } 
      }));

    return [...eventsData, ...tasksData];
  };

  calendarInstance = new FullCalendar.Calendar(el, {
    initialView: 'dayGridMonth',
    selectable: true,
    editable: true,
    
    // 1. Handle Drag and Drop for BOTH Events and Tasks
    eventDrop: async function(info) {
      const type = info.event.extendedProps.type;
      try {
        if (type === 'task') {
          await updateDoc(doc(db, 'tasks', info.event.id), { dueDate: info.event.startStr });
          showToast('Task deadline moved');
        } else {
          await updateDoc(doc(db, 'events', info.event.id), { date: info.event.startStr });
          showToast('Event moved');
        }
      } catch(e) {
        info.revert(); // Snap it back if Firebase fails
        showToast(e.message, 'error');
      }
    },
    
    // 2. Handle Clicking to Edit BOTH Events and Tasks
    eventClick: function(info) {
      const type = info.event.extendedProps.type;
      if (type === 'task') {
        openEditTaskModal(info.event.id);
      } else if (type === 'event') {
        openEditEventModal(info.event.id);
      }
    },

    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,listWeek'
    },
    
    dateClick: function(info) {
      const name = prompt('Event name for ' + info.dateStr + ':');
      if (name) {
        addDoc(collection(db, 'events'), {
          name, date: info.dateStr,
          createdBy: auth.currentUser?.email || '',
          createdAt: serverTimestamp()
        }).then(() => {
          showToast(`Event "${name}" added`);
          addNotification(`Event "${name}" created from calendar`);
        });
      }
    },
    
    // 3. Load the combined data
    events: getCombinedCalendarData()
  });
  
  calendarInstance.render();
}

function updateCalendarEvents() {
  if (!calendarInstance) return;
  
  // Remove all existing items from the visual calendar
  calendarInstance.getEvents().forEach(e => e.remove());
  
  // Re-add the fresh combined data
  const eventsData = allEvents.filter(e => e.date).map(e => ({ 
    title: e.name, start: e.date, id: e.id, backgroundColor: 'var(--accent)', borderColor: 'var(--accent)', extendedProps: { type: 'event' } 
  }));
  
  const tasksData = allTasks.filter(t => t.dueDate).map(t => ({ 
    title: `✅ ${t.title}`, start: t.dueDate, id: t.id, backgroundColor: 'var(--warning)', borderColor: 'var(--warning)', extendedProps: { type: 'task' } 
  }));

  [...eventsData, ...tasksData].forEach(item => {
    calendarInstance.addEvent(item);
  });
}

// ============================================================
//  PROFILE
// ============================================================
window.saveProfile = async function() {
  const user = auth.currentUser;
  const name = document.getElementById('profileName').value.trim();
  const role = document.getElementById('profileRole').value;
  if (!user) return showToast('Not logged in', 'error');
  if (!name) return showToast('Enter your name', 'error');

  try {
    await setDoc(doc(db, 'users', user.uid), {
      name, email: user.email, role, updatedAt: serverTimestamp()
    }, { merge: true });
    await fbUpdateProfile(user, { displayName: name });

    // Refresh display
    ['sidebarName','greetName','profileDisplayName'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = id === 'sidebarName' ? name : name.split(' ')[0];
    });
    ['sidebarAvatar','topbarAvatar','profileAvatar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = name[0].toUpperCase();
    });

    document.getElementById('profileStatus').textContent = '✓ Profile saved!';
    setTimeout(() => { document.getElementById('profileStatus').textContent = ''; }, 3000);
    showToast('Profile updated!');
  } catch(e) { showToast(e.message, 'error'); }
};

// ============================================================
//  HELPERS
// ============================================================
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  } catch { return dateStr; }
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - date) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

// Add this anywhere in app.js
window.toggleTheme = function() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
};

// Add this to the very bottom of app.js to remember the user's choice
const savedTheme = localStorage.getItem('theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);