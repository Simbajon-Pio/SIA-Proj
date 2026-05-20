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
let publicEvents = [];
let myNotificationIds = [];
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

  const urlParams = new URLSearchParams(window.location.search);
  const inviteEventId = urlParams.get('invite');
  
  if (inviteEventId) {
    try {
      // Add this user to the event as a guest with a 'pending' RSVP
      await updateDoc(doc(db, 'events', inviteEventId), {
        [`rsvps.${user.uid}`]: 'pending'
      });
      window.history.replaceState(null, '', window.location.pathname);
      showToast("You have successfully joined the event!");
    } catch (error) {
      console.error("Error joining event:", error);
    }
  }

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
  const user = auth.currentUser;
  if (!user) return; // Stop if no one is logged in

  // 1. EVENTS: The Master Filter & Discover Split
  onSnapshot(query(collection(db, 'events'), orderBy('createdAt', 'desc')), snap => {
    const fetchedEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // SECURITY: Save MY events (Created or RSVP'd)
    allEvents = fetchedEvents.filter(e => {
      const isCreator = e.createdBy === user.email;
      const isGuest = e.rsvps && typeof e.rsvps[user.uid] !== 'undefined';
      return isCreator || isGuest;
    });

    // DISCOVER: Save PUBLIC events that I haven't joined yet
    publicEvents = fetchedEvents.filter(e => {
      const isCreator = e.createdBy === user.email;
      const isGuest = e.rsvps && typeof e.rsvps[user.uid] !== 'undefined';
      return e.isPublic === true && !isCreator && !isGuest; 
    });

    renderEvents();
    renderOverview();
    
    // Safely trigger the Discover tab render
    if (typeof renderDiscover === 'function') {
      renderDiscover();
    }
    
    populateEventDropdown();
    updateBadge('eventsCount', allEvents.length);
    updateCalendarEvents();
    document.getElementById('statEvents').textContent = allEvents.length;
    // NEW: Fire the Smart Reminders Engine 2 seconds after data loads
    setTimeout(() => {
      if (typeof runSmartReminders === 'function') {
        runSmartReminders();
      }
    }, 2000);
  });

  // 2. TASKS: The Master Filter
  onSnapshot(query(collection(db, 'tasks'), orderBy('createdAt', 'desc')), snap => {
    const fetchedTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // SECURITY: Only save tasks that belong to my email
    allTasks = fetchedTasks.filter(t => t.assignedTo === user.email);

    renderTasks();
    renderOverview();
    updateBadge('tasksCount', allTasks.filter(t => t.status === 'Pending').length);
    const done = allTasks.filter(t => t.status === 'Done').length;
    const pending = allTasks.filter(t => t.status === 'Pending').length;
    document.getElementById('statDone').textContent = done;
    document.getElementById('statPending').textContent = pending;

    updateCalendarEvents();
  });

  // 3. NOTIFICATIONS: The Master Filter
  onSnapshot(query(collection(db, 'notifications'), orderBy('createdAt', 'desc')), snap => {
    const fetchedNotifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // SECURITY: Only save notifications meant for my user ID
    const myNotifs = fetchedNotifs.filter(n => n.userId === user.uid);

    // NEW: Save the database IDs so we can delete them later
    myNotificationIds = myNotifs.map(n => n.id);

    renderNotifications(myNotifs);
    const unread = myNotifs.filter(n => !n.read).length;
    updateBadge('notifCount', unread);
    document.getElementById('statNotifs').textContent = myNotifs.length;
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
  const description = document.getElementById('eventDescription').value.trim();
  const isPublic = document.getElementById('eventIsPublic').checked;
  const user     = auth.currentUser;

  if (!name) return showToast('Enter an event name', 'error');
  if (!user) return showToast('Not logged in', 'error');

  try {
    await addDoc(collection(db, 'events'), {
      name, 
      date: date || null, 
      location: location || null,
      description: description || null,
      createdBy: user.email,
      isPublic: isPublic,
      rsvps: {}, // NEW: Initialize empty RSVP tracker
      createdAt: serverTimestamp()
    });
    document.getElementById('eventName').value = '';
    document.getElementById('eventDate').value = '';
    document.getElementById('eventLocation').value = '';
    document.getElementById('eventDescription').value = '';
    document.getElementById('eventIsPublic').checked = false;
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
window.openEditEventModal = async function(id) {
  const e = allEvents.find(x => x.id === id);
  if(!e) return;

  document.getElementById('editEventId').value = e.id;
  document.getElementById('editEventName').value = e.name || '';
  document.getElementById('editEventDate').value = e.date || '';
  document.getElementById('editEventLocation').value = e.location || '';
  document.getElementById('editEventDescription').value = e.description || '';
  document.getElementById('editEventIsPublic').checked = e.isPublic === true;

  // NEW: Render the guest list responses inside the modal
  const listEl = document.getElementById('modalRsvpList');
  if (listEl) {
    const rsvps = e.rsvps || {};
    const keys = Object.keys(rsvps);
    
    if (keys.length === 0) {
      listEl.innerHTML = '<div style="color:#666; text-align:center; padding: 10px;">No guests invited yet.</div>';
    } else {
      // Show a loading message while we translate the IDs into names
      listEl.innerHTML = '<div style="color:#666; text-align:center; padding: 10px;">Loading guest list...</div>';
      
      let htmlLines = [];
      
      // Loop through every person who RSVP'd
      for (let uid of keys) {
        const status = rsvps[uid];
        let statusColor = '#666';
        if (status === 'yes') statusColor = '#10b981';
        if (status === 'maybe') statusColor = '#f59e0b';
        if (status === 'no') statusColor = '#ef4444';
        
        let displayName = `Guest (${uid.substring(0,5)}...)`; // Fallback name
        
        try {
          // Look up the specific user in the 'users' collection
          const userSnap = await getDoc(doc(db, 'users', uid));
          if (userSnap.exists()) {
            const userData = userSnap.data();
            displayName = userData.name || userData.email.split('@');
          }
        } catch(err) {
          console.warn("Could not fetch user name for", uid);
        }

        htmlLines.push(`
          <div class="guest-rsvp-row" style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
            <span style="color:#ddd; font-weight: 500;">👤 ${escHtml(displayName)}</span>
            <span class="status-badge" style="color:${statusColor}; font-weight: bold; text-transform: uppercase; font-size: 0.75rem;">${status}</span>
          </div>
        `);
      }
      
      // Remove the borders from the last item and draw the final list
      if(htmlLines.length > 0) {
        htmlLines[htmlLines.length - 1] = htmlLines[htmlLines.length - 1].replace('border-bottom: 1px solid rgba(255,255,255,0.05);', '');
      }
      listEl.innerHTML = htmlLines.join('');
    }
  }

  document.getElementById('editEventModal').style.display = 'flex';
};

window.saveEventEdit = async function() {
  // 1. Grab the updated text from the inputs
  const id = document.getElementById('editEventId').value;
  const name = document.getElementById('editEventName').value.trim();
  const date = document.getElementById('editEventDate').value;
  const location = document.getElementById('editEventLocation').value.trim();
  const description = document.getElementById('editEventDescription').value.trim();
  const isPublic = document.getElementById('editEventIsPublic').checked;

  if (!name) return showToast('Enter an event name', 'error');

  try {
    // 2. Push the changes to Firebase
    await updateDoc(doc(db, 'events', id), {
      name: name,
      date: date || null,
      location: location || null,
      description: description || null,
      isPublic: isPublic
    });
    
    // 3. Hide modal and notify the user
    document.getElementById('editEventModal').style.display = 'none';
    showToast('Event updated successfully!');
  } catch(e) { 
    showToast(e.message, 'error'); 
  }
};
function renderEvents() {
  const grid = document.getElementById('eventGrid');
  const empty = document.getElementById('eventEmpty');
  if (!grid) return;

  const user = auth.currentUser;
  if (!user) return; 

  const q = (document.getElementById('eventSearch')?.value || '').toLowerCase();

  // THE BUG FIX: Simplified Data Isolation (Creator or Guest)
  const filtered = allEvents.filter(e => {
    const isCreator = e.createdBy === user.email;
    const isGuest = e.rsvps && typeof e.rsvps[user.uid] !== 'undefined';
    const matchesSearch = e.name.toLowerCase().includes(q);

    // ONLY show if they created it OR were invited
    return (isCreator || isGuest) && matchesSearch;
  });

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
    
    // UI Permissions
    const isCreator = e.createdBy === user.email;

    // Calculate RSVPs
    const rsvps = e.rsvps || {};
    let yesCount = 0, maybeCount = 0, noCount = 0;
    Object.values(rsvps).forEach(status => {
      if (status === 'yes') yesCount++;
      if (status === 'maybe') maybeCount++;
      if (status === 'no') noCount++;
    });
    const myRsvp = rsvps[user.uid] || null;

    // NEW: The card now has 'clickable-card' and an onclick handler
    return `
    <div class="event-card clickable-card" onclick="toggleEventDetails(event, '${e.id}')">
      <div class="event-card-header">
        <div class="event-dot"></div>
        <span class="event-name" style="flex: 1;">${escHtml(e.name)}</span>
        <div style="display:flex; gap:4px;">
          <button class="btn-icon" onclick="copyInviteLink('${e.id}'); event.stopPropagation();" title="Invite Guests">🔗</button>
          ${isCreator ? `<button class="btn-icon" onclick="openEditEventModal('${e.id}'); event.stopPropagation();" title="Edit">✏️</button>` : ''}
          ${isCreator ? `<button class="btn-icon danger" onclick="deleteEvent('${e.id}','${escHtml(e.name)}'); event.stopPropagation();" title="Delete">🗑</button>` : ''}
        </div>
      </div>
      
      ${e.date ? `<div class="event-meta">📅 ${formatDate(e.date)}</div>` : ''}
      ${e.location ? `<div class="event-meta">📍 ${escHtml(e.location)}</div>` : ''}
      <div class="event-meta">👤 ${e.createdBy}</div>
      
      <div class="rsvp-stats" style="margin-top: 10px; font-size: 0.85rem; color: #a0a0a0;">
        <span style="margin-right: 10px;">✅ ${yesCount}</span>
        <span style="margin-right: 10px;">❓ ${maybeCount}</span>
        <span>❌ ${noCount}</span>
      </div>
      
      <div class="rsvp-actions" style="display: flex; gap: 4px; margin-top: 8px;">
        <button class="btn-rsvp ${myRsvp === 'yes' ? 'active-yes' : ''}" onclick="updateRsvp('${e.id}', 'yes'); event.stopPropagation();">Yes</button>
        <button class="btn-rsvp ${myRsvp === 'maybe' ? 'active-maybe' : ''}" onclick="updateRsvp('${e.id}', 'maybe'); event.stopPropagation();">Maybe</button>
        <button class="btn-rsvp ${myRsvp === 'no' ? 'active-no' : ''}" onclick="updateRsvp('${e.id}', 'no'); event.stopPropagation();">No</button>
      </div>

      <div id="drawer-${e.id}" class="event-details-drawer">
        ${e.description ? `
          <div style="color: #b0b0b0; font-size: 0.9rem; line-height: 1.5; white-space: pre-wrap; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
            📝 ${escHtml(e.description)}
          </div>
        ` : ''}
        
        <div style="font-size: 0.85rem; color: var(--accent); font-weight: 600; margin-bottom: 6px;">Attendee List:</div>
        <div id="guest-list-${e.id}" style="font-size: 0.85rem;">
          <span style="color:#666; font-style:italic;">Click to load guests...</span>
        </div>
      </div>

      ${taskCount > 0 ? `
        <div class="progress-wrap" style="margin-top:12px;">
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
  const user = auth.currentUser;
  
  if (!user) return;

  // 1. Filter events just like we did on the main dashboard
  const myEvents = allEvents.filter(e => {
    const isCreator = e.createdBy === user.email;
    const isGuest = e.rsvps && typeof e.rsvps[user.uid] !== 'undefined';
    return isCreator || isGuest;
  });

  if (recentEvents) {
    if (myEvents.length === 0) {
      recentEvents.innerHTML = '<div class="empty-mini">No events yet</div>';
    } else {
      recentEvents.innerHTML = myEvents.slice(0, 5).map(e => `
        <div class="list-item">
          <div class="list-dot event-dot-sm"></div>
          <div>
            <div class="list-title">${escHtml(e.name)}</div>
            ${e.date ? `<div class="list-sub">📅 ${formatDate(e.date)}</div>` : ''}
          </div>
        </div>`).join('');
    }
  }

  // 2. Filter tasks so users only see their own tasks
  const myTasks = allTasks.filter(t => t.assignedTo === user.email);

  if (recentTasks) {
    const pending = myTasks.filter(t => t.status === 'Pending').slice(0, 5);
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
  
  try {
    // Loop through the saved IDs and actually delete them from Firestore
    for (let id of myNotificationIds) {
      await deleteDoc(doc(db, 'notifications', id));
    }
    
    // (Notice we don't need list.innerHTML = '' anymore! 
    // Because we deleted the data, the real-time listener will instantly clear the screen for us.)
    
    showToast('Notifications completely cleared!');
  } catch(e) {
    showToast('Failed to clear notifications.', 'error');
  }
};

window.markAllRead = async function() {
  const user = auth.currentUser;
  if (!user) return;
  
  try {
    // Loop through the saved IDs and update their read status to true
    for (let id of myNotificationIds) {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    }
    
    showToast('All notifications marked as read!');
  } catch(e) {
    showToast('Failed to mark notifications as read.', 'error');
  }
};

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

window.copyInviteLink = (eventId) => {
  const inviteLink = `${window.location.origin}?invite=${eventId}`;
  navigator.clipboard.writeText(inviteLink).then(() => {
    showToast("🔗 Invite link copied! Send it to your friends.");
  }).catch(err => {
    console.error('Failed to copy: ', err);
  });
};

window.updateRsvp = async (eventId, status) => {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const eventRef = doc(db, 'events', eventId);
    await updateDoc(eventRef, {
      [`rsvps.${user.uid}`]: status
    });
    showToast(`RSVP updated to ${status}`);
  } catch (error) {
    showToast("Failed to update RSVP.", 'error');
  }
};

// ============================================================
//  DISCOVER / PUBLIC EVENTS
// ============================================================
function renderDiscover() {
  const grid = document.getElementById('discoverGrid');
  const empty = document.getElementById('discoverEmpty');
  if (!grid) return;

  if (publicEvents.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  grid.innerHTML = publicEvents.map(e => `
    <div class="event-card" style="border-left: 4px solid var(--accent);">
      <div class="event-card-header">
        <div class="event-dot"></div>
        <span class="event-name" style="flex: 1;">${escHtml(e.name)}</span>
      </div>
      ${e.date ? `<div class="event-meta">📅 ${formatDate(e.date)}</div>` : ''}
      ${e.location ? `<div class="event-meta">📍 ${escHtml(e.location)}</div>` : ''}
      ${e.description ? `<div class="event-meta" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.05); color: #b0b0b0; font-size: 0.85rem; font-style: italic;">📝 ${escHtml(e.description)}</div>` : ''}
      <div class="event-meta" style="margin-bottom: 12px;">👤 Hosted by: ${e.createdBy}</div>

      <div id="drawer-${e.id}" class="event-details-drawer">
        ${e.description ? `
          <div style="color: #b0b0b0; font-size: 0.9rem; line-height: 1.5; white-space: pre-wrap; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
            📝 ${escHtml(e.description)}
          </div>
        ` : ''}
        
        <div style="font-size: 0.85rem; color: var(--accent); font-weight: 600; margin-bottom: 6px;">Attendee List:</div>
        <div id="guest-list-${e.id}" style="font-size: 0.85rem;">
          <span style="color:#666; font-style:italic;">Click to load guests...</span>
        </div>
      </div>
      
      <div class="rsvp-actions">
        <button class="btn-rsvp" onclick="directDiscoverRsvp('${e.id}', 'yes')">✓ Yes</button>
        <button class="btn-rsvp" onclick="directDiscoverRsvp('${e.id}', 'maybe')">? Maybe</button>
        <button class="btn-rsvp" onclick="directDiscoverRsvp('${e.id}', 'no')">✗ No</button>
      </div>
    </div>
  `).join('');
}

// NEW: Handles the direct vote from the Discover Tab
window.directDiscoverRsvp = async function(eventId, status) {
  const user = auth.currentUser;
  if (!user) return showToast("You must be logged in to RSVP", "error");
  
  try {
    // Instantly save their vote to the database
    await updateDoc(doc(db, 'events', eventId), {
      [`rsvps.${user.uid}`]: status
    });
    
    // The Master Filter will automatically move the card to their dashboard now!
    showToast(`RSVP saved as '${status.toUpperCase()}'. Event moved to your dashboard!`);
  } catch (error) {
    showToast("Failed to save RSVP.", 'error');
  }
};

window.toggleEventDetails = async function(event, eventId) {
  // Prevent toggling if they clicked a button inside the card
  if (event.target.tagName.toLowerCase() === 'button' || event.target.closest('button')) {
    return; 
  }
  
  const drawer = document.getElementById(`drawer-${eventId}`);
  if (!drawer) return;

  // Toggle the CSS class to open/close it
  drawer.classList.toggle('expanded');

  // If the drawer is OPENING, fetch the guest names
  if (drawer.classList.contains('expanded')) {
    const guestListEl = document.getElementById(`guest-list-${eventId}`);
    if (!guestListEl) return;

    // If we already loaded the guests, don't waste time fetching them again
    if (guestListEl.dataset.loaded === "true") return;
    
    guestListEl.innerHTML = '<span style="color:#666;">Loading guests...</span>';

    // Find the event data
    const e = allEvents.find(x => x.id === eventId);
    if (!e) return;

    const rsvps = e.rsvps || {};
    const keys = Object.keys(rsvps);
    
    if (keys.length === 0) {
      guestListEl.innerHTML = '<span style="color:#666;">No guests have RSVP\'d yet.</span>';
      guestListEl.dataset.loaded = "true"; // Mark as loaded
      return;
    }

    let htmlLines = [];
    
    // Loop through every person who RSVP'd to get their actual name
    for (let uid of keys) {
      const status = rsvps[uid];
      let statusColor = '#666';
      if (status === 'yes') statusColor = '#10b981';
      if (status === 'maybe') statusColor = '#f59e0b';
      if (status === 'no') statusColor = '#ef4444';
      
      let displayName = `Guest (${uid.substring(0,5)}...)`; // Fallback name
      
      try {
        const userSnap = await getDoc(doc(db, 'users', uid));
        if (userSnap.exists()) {
          const userData = userSnap.data();
          displayName = userData.name || userData.email.split('@');
        }
      } catch(err) {
        console.warn("Could not fetch user name for", uid);
      }

      htmlLines.push(`
        <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.02);">
          <span style="color:#ddd;">👤 ${escHtml(displayName)}</span>
          <span style="color:${statusColor}; font-weight: bold; font-size: 0.75rem; text-transform: uppercase;">${status}</span>
        </div>
      `);
    }
    
    // Remove the border from the last item
    if(htmlLines.length > 0) {
      htmlLines[htmlLines.length - 1] = htmlLines[htmlLines.length - 1].replace('border-bottom: 1px solid rgba(255,255,255,0.02);', '');
    }
    
    guestListEl.innerHTML = htmlLines.join('');
    guestListEl.dataset.loaded = "true"; // Mark as loaded so we don't fetch it repeatedly
  }
};
// ============================================================
//  SMART REMINDERS ENGINE (TIMEZONE SAFE)
// ============================================================
window.runSmartReminders = async function() {
  const user = auth.currentUser;
  if (!user) return;

  // 1. Get exact date strings for comparison
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  
  // THE FIX: A custom formatter that ignores UTC and strictly uses your local timezone
  const getLocalYYYYMMDD = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const tomorrowString = getLocalYYYYMMDD(tomorrow);
  const todayString = getLocalYYYYMMDD(today);

  // 2. Scan Events: Alert if happening tomorrow
  allEvents.forEach(async (e) => {
    if (e.date === tomorrowString) {
      const storageKey = `reminder_event_${e.id}_${user.uid}`;
      
      // If we haven't reminded them yet, fire the notification!
      if (!localStorage.getItem(storageKey)) {
        try {
          await addDoc(collection(db, 'notifications'), {
            userId: user.uid,
            title: '📅 Upcoming Event!',
            message: `"${e.name}" is happening tomorrow. Check your tasks!`,
            read: false,
            createdAt: serverTimestamp()
          });
          // Drop a receipt so we don't spam them on the next refresh
          localStorage.setItem(storageKey, 'true');
        } catch (err) {
          console.error("Failed to send event reminder:", err);
        }
      }
    }
  });

  // 3. Scan Tasks: Daily summary for pending tasks
  const pendingTasks = allTasks.filter(t => t.status === 'Pending');
  if (pendingTasks.length > 0) {
    const storageKey = `reminder_tasks_${todayString}_${user.uid}`;
    
    // Only warn them once per day about their pending workload
    if (!localStorage.getItem(storageKey)) {
      try {
        await addDoc(collection(db, 'notifications'), {
          userId: user.uid,
          title: '⚠️ Pending Tasks',
          message: `You have ${pendingTasks.length} task(s) left to complete.`,
          read: false,
          createdAt: serverTimestamp()
        });
        localStorage.setItem(storageKey, 'true');
      } catch (err) {
        console.error("Failed to send task reminder:", err);
      }
    }
  }
};