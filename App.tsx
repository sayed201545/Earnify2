/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';

declare global {
  interface Window {
    Telegram: any;
    firebase: any;
    [key: string]: any;
  }
}

export default function App() {
  useEffect(() => {
    const tg = window.Telegram.WebApp;
    const firebase = window.firebase;
    
    if (!firebase || !tg) {
      console.error("Firebase or Telegram SDK not found");
      return;
    }

    const firebaseConfig = {
      apiKey: "AIzaSyB03K2JAA4iyBLgAX6Nv9Z0VMGX3qMGqBc",
      authDomain: "earnify-f3ac8.firebaseapp.com",
      databaseURL: "https://earnify-f3ac8-default-rtdb.firebaseio.com",
      projectId: "earnify-f3ac8",
      storageBucket: "earnify-f3ac8.firebasestorage.app",
      messagingSenderId: "273672601348",
      appId: "1:273672601348:web:4d627b5689575857345a51",
      measurementId: "G-9VTHYEVSVE"
    };

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    const db = firebase.database();

    let appConfig: any = {};
    let userState: any = {};
    let tgUser: any = {};
    let earningWallet = 0;
    let leaderboardData = { referral: [] as any[], earning: [] as any[] };
    let deviceId: string | null = null;
    window.adRunning = false;

    // Helper UI
    const formatTime = (seconds: number) => {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    const showModal = (id: string) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'flex';
    };
    const hideModal = (id: string) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    };

    async function addHistory(type: string, name: string, reward: number, status: string, message: string = "") {
      const historyRef = db.ref(`users/${tgUser.id}/history`).push();
      await historyRef.set({
        type,
        name,
        reward,
        status,
        message,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
    }

    async function showHistory() {
      const snap = await db.ref(`users/${tgUser.id}/history`).orderByChild('timestamp').limitToLast(50).once('value');
      let allReqs: any[] = [];
      snap.forEach((r: any) => {
        const val = r.val();
        if (val) allReqs.push(val);
      });
      allReqs.sort((a, b) => b.timestamp - a.timestamp);
      
      let html = `<div class="modal-header"><h3>Task History</h3><button class="close-modal">&times;</button></div><div style="max-height: 70vh; overflow-y: auto;">`;
      if (allReqs.length === 0) html += "<p style='padding:20px; text-align:center;'>No history found.</p>";
      
      allReqs.forEach(req => {
        const date = new Date(req.timestamp).toLocaleString();
        const color = req.status === 'Completed' ? '#27ae60' : (req.status === 'Rejected' ? '#e74c3c' : '#f39c12');
        html += `
          <div class="history-item" style="padding: 12px; border-bottom: 1px solid rgba(0,0,0,0.05); background: white; margin-bottom: 5px; border-radius: 8px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div>
                <strong style="font-size: 0.9rem;">${req.name}</strong><br/>
                <small style="color:gray; font-size: 0.7rem;">${date}</small>
              </div>
              <div style="text-align:right;">
                <span style="color:${color}; font-weight:bold; font-size: 0.9rem;">${req.reward} Coins</span><br/>
                <small style="color:${color}; font-size: 0.7rem; font-weight: 600;">${req.status}</small>
              </div>
            </div>
            ${req.message ? `<p style="font-size:0.75rem; color:#e74c3c; margin-top:5px; font-style: italic;">Reason: ${req.message}</p>` : ''}
          </div>
        `;
      });
      html += `</div>`;
      
      const body = document.getElementById('global-popup-body');
      if (body) {
        body.innerHTML = html;
        showModal('global-popup');
        document.querySelectorAll('#global-popup .close-modal').forEach(btn => {
          btn.addEventListener('click', () => hideModal('global-popup'));
        });
      }
    }

    const showAlert = (msg: string, callback?: () => void) => {
      const body = document.getElementById('global-popup-body');
      if (body) {
        body.innerHTML = `<div style="text-align:center; padding: 20px;"><h3>Notification</h3><p style="margin: 15px 0;">${msg}</p><button class="action-btn close-modal" style="margin-top:20px;">OK</button></div>`;
        showModal('global-popup');
        const closeBtn = document.querySelector('#global-popup .close-modal') as HTMLElement;
        if (closeBtn) {
          closeBtn.onclick = () => {
            hideModal('global-popup');
            if (callback) callback();
          };
        }
      } else {
        // Fallback to native if modal body not found
        if (tg.showAlert) {
          try { tg.showAlert(msg, callback); } catch(e) { alert(msg); if(callback) callback(); }
        } else {
          alert(msg);
          if (callback) callback();
        }
      }
    };

    // Override Telegram methods for older versions to prevent crashes
    const tgVersion = tg.version ? parseFloat(tg.version) : 0;
    if (tgVersion < 6.2) {
      tg.showAlert = showAlert;
      tg.showPopup = (params: any, callback?: (id: string) => void) => {
        showAlert(params.message || params.text || "Notification", () => {
          if (callback) callback("ok");
        });
      };
    }

    // Loader
    let progress = 0;
    function updateLoader(p: number, text?: string) {
      progress = p;
      const el = document.getElementById('loading-progress');
      if (el) el.innerText = Math.floor(progress) + '%';
      const textEl = document.getElementById('loading-text');
      if (textEl && text) textEl.innerText = text;
    }

    // Device Lock: one device one account
    async function enforceDeviceLock(userId: any) {
      let storedDevice = localStorage.getItem('device_id');
      if (!storedDevice) {
        storedDevice = 'dev_' + Date.now() + '_' + Math.random().toString().replace(/[^a-zA-Z0-9_-]/g, '_');
        localStorage.setItem('device_id', storedDevice);
      }
      deviceId = String(storedDevice).replace(/[^a-zA-Z0-9_-]/g, '_');
      if (!deviceId) deviceId = 'unknown_device_' + Date.now();
      
      const lockSnap = await db.ref(`deviceLock/${deviceId}`).once('value');
      const lockedUser = lockSnap.val();
      if (lockedUser && lockedUser !== userId) {
        showAlert("This device is already linked to another account. One device = one account.", () => tg.close());
        throw new Error("Device locked");
      }
      if (!lockedUser) await db.ref(`deviceLock/${deviceId}`).set(userId);
    }

    // Admin Notification
    async function sendAdminNotification(message: string) {
      const botToken = appConfig.botToken;
      const chatId = appConfig.adminChatId;
      if (!botToken || !chatId) return;
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: message })
        });
      } catch (e) { console.warn(e); }
    }

    // Load Ad SDK and Wait
    async function loadAdAndWait(zoneId: string) {
      const targetZone = zoneId || '10806089';
      return new Promise<void>((resolve, reject) => {
        if (typeof window["show_" + targetZone] === "function") {
          return resolve();
        }

        // Check if script already exists to prevent duplicate loading
        const existingScript = document.querySelector(`script[data-zone="${targetZone}"]`);
        if (!existingScript) {
          const script = document.createElement("script");
          script.src = "https://libtl.com/sdk.js";
          script.async = true;
          script.setAttribute("data-zone", targetZone);
          script.setAttribute("data-sdk", "show_" + targetZone);
          document.body.appendChild(script);
        }

        let check = setInterval(() => {
          if (typeof window["show_" + targetZone] === "function") {
            clearInterval(check);
            resolve();
          }
        }, 300);

        setTimeout(() => {
          clearInterval(check);
          if (typeof window["show_" + targetZone] === "function") {
            resolve();
          } else {
            reject("Ad load timeout");
          }
        }, 10000); // 10s timeout for better stability
      });
    }

    async function loadUserData() {
      const userRef = db.ref(`users/${tgUser.id}`);
      const snap = await userRef.once('value');
      let data = snap.val();
      if (!data) {
        const startParam = tg.initDataUnsafe.start_param;
        const referralId = (startParam && !isNaN(startParam)) ? startParam : null;
        data = {
          id: tgUser.id, firstName: tgUser.first_name || '', lastName: tgUser.last_name || '', username: tgUser.username || '',
          photoUrl: tgUser.photo_url || '', balance: 0, earningWallet: 0, referrals: 0, referredBy: referralId, totalEarned: 0,
          lifetimeAdCount: 0, lastAdWatchDate: new Date().toISOString().slice(0, 10), dailyAdCount: 0,
          breakUntil: 0, completedTasks: {}, welcomed: false, lastCheckInDate: "", checkInStreak: 0
        };
        await userRef.set(data);
        if (referralId && referralId != tgUser.id && appConfig.referralBonus) {
          const bonus = parseFloat(appConfig.referralBonus);
          if (bonus > 0) {
            await db.ref(`users/${referralId}/earningWallet`).transaction((b: any) => (b || 0) + bonus);
            await db.ref(`users/${referralId}/referrals`).transaction((r: any) => (r || 0) + 1);
            await sendAdminNotification(`👥 Referral Bonus\nUser: ${tgUser.first_name} (${tgUser.id}) joined via referral from ${referralId}\nBonus: ${bonus} Coins\nTime: ${new Date().toLocaleString()}`);
          } else {
            await db.ref(`users/${referralId}/referrals`).set(firebase.database.ServerValue.increment(1));
            await sendAdminNotification(`👥 New Referral\nUser: ${tgUser.first_name} (${tgUser.id}) joined via referral from ${referralId}\nTime: ${new Date().toLocaleString()}`);
          }
        }
      }
      const today = new Date().toISOString().slice(0, 10);
      if (data.lastAdWatchDate !== today) {
        data.dailyAdCount = 0; data.lastAdWatchDate = today;
        await userRef.update({ dailyAdCount: 0, lastAdWatchDate: today });
      }

      // Check-in streak reset logic
      if (data.lastCheckInDate) {
        const lastDate = new Date(data.lastCheckInDate);
        const todayDate = new Date(today);
        const diffTime = Math.abs(todayDate.getTime() - lastDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays > 1) {
          data.checkInStreak = 0;
          await userRef.update({ checkInStreak: 0 });
        }
      }

      userState = data;
      earningWallet = data.earningWallet || 0;
      renderAll();
    }

    async function loadLeaderboard() {
      const referralSnap = await db.ref('users').orderByChild('referrals').limitToLast(10).once('value');
      const earningSnap = await db.ref('users').orderByChild('totalEarned').limitToLast(10).once('value');
      leaderboardData.referral = []; leaderboardData.earning = [];
      referralSnap.forEach((c: any) => leaderboardData.referral.push(c.val()));
      earningSnap.forEach((c: any) => leaderboardData.earning.push(c.val()));
      leaderboardData.referral.reverse(); leaderboardData.earning.reverse();
    }

    function renderAll() {
      const photoEl = document.getElementById('user-photo') as HTMLImageElement;
      if (photoEl) photoEl.src = userState.photoUrl || 'https://via.placeholder.com/44';
      
      const nameEl = document.getElementById('user-name');
      if (nameEl) nameEl.innerHTML = `${userState.firstName} ${userState.lastName}`;
      
      const balanceEl = document.getElementById('main-balance');
      if (balanceEl) balanceEl.innerText = (userState.balance || 0).toFixed(0);
      
      const dailyAdsEl = document.getElementById('daily-ads-watched');
      if (dailyAdsEl) dailyAdsEl.innerHTML = `${userState.dailyAdCount || 0} / ${appConfig.dailyAdLimit || 0}`;
      
      const refCountEl = document.getElementById('referral-count');
      if (refCountEl) refCountEl.innerText = userState.referrals || 0;
      
      const totalAdsEl = document.getElementById('total-ads-watched');
      if (totalAdsEl) totalAdsEl.innerText = userState.lifetimeAdCount || 0;
      
      const totalEarnedEl = document.getElementById('total-earned');
      if (totalEarnedEl) totalEarnedEl.innerText = (userState.totalEarned || 0).toFixed(0) + " Coins";

      const earningWalletEl = document.getElementById('earning-wallet-balance');
      if (earningWalletEl) earningWalletEl.innerText = (userState.earningWallet || 0).toFixed(0);

      const profilePhotoLarge = document.getElementById('profile-photo-large') as HTMLImageElement;
      if (profilePhotoLarge) profilePhotoLarge.src = userState.photoUrl || 'https://via.placeholder.com/100';
      const profileNameLarge = document.getElementById('profile-name-large');
      if (profileNameLarge) profileNameLarge.innerText = `${userState.firstName} ${userState.lastName}`;
      const profileId = document.getElementById('profile-id');
      if (profileId) profileId.innerText = userState.id || '0';
      const profileUsername = document.getElementById('profile-username');
      if (profileUsername) profileUsername.innerText = userState.username || 'N/A';
      
      const walletBalanceEl = document.getElementById('earning-wallet-balance');
      if (walletBalanceEl) walletBalanceEl.innerText = earningWallet.toFixed(0);
      
      const moveBtn = document.getElementById('move-to-balance-btn') as HTMLButtonElement;
      if (moveBtn) moveBtn.disabled = earningWallet < 100;
      
      renderDailyCheckIn();
      renderAdProgress();
      renderAdTask();
      renderTgTasks();
      renderWebTasks();
      renderReferralSection();
      renderEarningsGraph();
    }

    let lastCheckInHtml = '';
    function renderDailyCheckIn() {
      const today = new Date().toISOString().slice(0, 10);
      const container = document.getElementById('daily-checkin-container');
      if (!container) return;

      if (userState.lastCheckInDate === today) {
        if (lastCheckInHtml !== '') {
          container.innerHTML = '';
          lastCheckInHtml = '';
        }
        return;
      }

      const streak = (userState.checkInStreak || 0) + 1;
      const reward = 50; // Example reward

      let html = '';
      if (userState.checkInTimer) {
        const elapsed = Date.now() - userState.checkInTimer;
        if (elapsed >= 10000) {
          // Auto claim if timer done
          claimDailyCheckIn();
          return;
        }
        const rem = Math.ceil((10000 - elapsed) / 1000);
        html = `
          <div class="daily-checkin-card">
            <div class="checkin-info">
              <h3>Day ${streak} Check-in</h3>
              <p>${today}</p>
            </div>
            <button class="action-btn" disabled>Verifying (${formatTime(rem)})</button>
          </div>`;
      } else {
        html = `
          <div class="daily-checkin-card">
            <div class="checkin-info">
              <h3>Day ${streak} Check-in</h3>
              <p>${today}</p>
            </div>
            <button id="start-checkin-btn" class="action-btn">Claim Daily Reward</button>
          </div>`;
      }

      if (lastCheckInHtml !== html) {
        container.innerHTML = html;
        lastCheckInHtml = html;
        document.getElementById('start-checkin-btn')?.addEventListener('click', async () => {
          userState.checkInTimer = Date.now();
          await sendAdminNotification(`🎁 Daily Check-in Started\nUser: ${tgUser.first_name} (${tgUser.id})\nDay: ${streak}\nTime: ${new Date().toLocaleString()}`);
          renderDailyCheckIn();
        });
      }
    }

    async function claimDailyCheckIn() {
      const today = new Date().toISOString().slice(0, 10);
      const reward = 50;
      const streak = (userState.checkInStreak || 0) + 1;
      
      delete userState.checkInTimer;
      userState.lastCheckInDate = today;
      userState.checkInStreak = streak;
      userState.earningWallet = (userState.earningWallet || 0) + reward;
      earningWallet = userState.earningWallet;
      userState.totalEarned += reward;
      
      await db.ref(`users/${tgUser.id}`).update({
        lastCheckInDate: today,
        checkInStreak: streak,
        earningWallet: userState.earningWallet,
        totalEarned: userState.totalEarned
      });
      
      await addHistory('Daily Check-in', `Day ${streak} Reward`, reward, 'Completed');
      await sendAdminNotification(`🎁 Daily Check-in\nUser: ${tgUser.first_name} (${tgUser.id})\nReward: ${reward} Coins\nTime: ${new Date().toLocaleString()}`);
      showAlert(`+${reward} Coins added to Earning Wallet!`);
      renderAll();
    }

    let lastAdProgressHtml = '';
    function renderAdProgress() {
      const dailyLimit = appConfig.dailyAdLimit || 1;
      const watched = userState.dailyAdCount || 0;
      const percent = (watched / dailyLimit) * 100;
      const container = document.getElementById('ad-progress-container');
      if (container) {
        const html = `
          <div class="progress-container"><div class="progress-info"><span>Daily Ad Progress</span><span>${watched}/${dailyLimit}</span></div>
          <div class="progress-bar-bg"><div class="progress-bar-fg" style="width:${percent}%"></div></div></div>`;
        if (lastAdProgressHtml !== html) {
          container.innerHTML = html;
          lastAdProgressHtml = html;
        }
      }
    }

    async function handleWatchAd() {
      if (window.adRunning) return;
      window.adRunning = true;

      const zoneId = appConfig.adZoneId || '10806089';

      if (userState.dailyAdCount >= (appConfig.dailyAdLimit || 50)) {
        showAlert("Daily limit reached");
        window.adRunning = false;
        return;
      }

      const body = document.getElementById('global-popup-body');
      if (body) {
        body.innerHTML = `
          <div class="popup-loader">
            <div class="spinner"></div>
          </div>
          <p>Loading Ad...</p>
        `;
        showModal('global-popup');
      }

      try {
        // ✅ wait for ad ready
        await loadAdAndWait(zoneId);

        const adFunction = window["show_" + zoneId];

        // 🚀 RUN AD
        if (typeof adFunction === 'function') {
          await adFunction();
        } else {
          throw new Error("Ad function not found");
        }

        hideModal('global-popup');

        // 💰 KEEP SAME REWARD SYSTEM
        const adValue = parseFloat(appConfig.adValue) || 0;

        earningWallet += adValue;
        userState.earningWallet = earningWallet;
        localStorage.setItem(`earningWallet_${tgUser.id}`, earningWallet.toString());

        userState.dailyAdCount++;
        userState.lifetimeAdCount++;
        userState.totalEarned = (userState.totalEarned || 0) + adValue;

        await db.ref(`users/${tgUser.id}`).update({
          dailyAdCount: userState.dailyAdCount,
          lifetimeAdCount: userState.lifetimeAdCount,
          totalEarned: userState.totalEarned,
          earningWallet: earningWallet
        });

        showAlert(`+${adValue} earned`);
        renderAll();

      } catch (e) {
        console.error("Ad Error:", e);
        hideModal('global-popup');
        showAlert("Ad failed, try again");
      }

      window.adRunning = false;
    }

    let lastAdHtml = '';
    function renderAdTask() {
      const onBreak = userState.breakUntil && Date.now() < userState.breakUntil;
      const limitReached = userState.dailyAdCount >= (appConfig.dailyAdLimit || 0);
      const adRunning = window.adRunning;
      
      let html = '';
      if (onBreak) {
        let rem = Math.ceil((userState.breakUntil - Date.now()) / 1000);
        html = `<div class="task-container"><div class="task-info"><h3>Break</h3><p>Wait ${formatTime(rem)}</p></div><button class="action-btn" disabled>Wait</button></div>`;
      } else if (limitReached) {
        html = `<div class="task-container"><div class="task-info"><h3>Limit Reached</h3><p>Come back tomorrow</p></div><button disabled>Done</button></div>`;
      } else {
        html = `
          <div class="task-container">
            <img class="task-icon-img" src="https://img.icons8.com/color/96/play--v1.png"/>
            <div class="task-info"><h3>Watch Ad</h3><p>Earn ${appConfig.adValue} Coins</p></div>
            <button id="watch-ad-btn" class="action-btn" ${adRunning ? 'disabled' : ''}>${adRunning ? 'Watching...' : 'Watch Now'}</button>
          </div>
        `;
      }
      const container = document.getElementById('ad-task-container');
      if (container && lastAdHtml !== html) {
        container.innerHTML = html;
        lastAdHtml = html;
        if (!onBreak && !limitReached && !adRunning) {
          document.getElementById('watch-ad-btn')?.addEventListener('click', handleWatchAd);
        }
      }
    }

    async function moveToBalance() {
      if ((userState.earningWallet || 0) < 100) return;
      const btn = document.getElementById('move-to-balance-btn') as HTMLButtonElement;
      if (btn) {
        btn.disabled = true; btn.textContent = 'Moving...';
      }
      const amount = userState.earningWallet;
      await db.ref(`users/${tgUser.id}/balance`).set(firebase.database.ServerValue.increment(amount));
      await db.ref(`users/${tgUser.id}/earningWallet`).set(0);
      userState.balance += amount;
      userState.earningWallet = 0;
      earningWallet = 0;
      renderAll();
      await sendAdminNotification(`💸 Wallet Transfer\nUser: ${tgUser.first_name} (${tgUser.id})\nAmount: ${amount} Coins\nNew Balance: ${userState.balance}\nTime: ${new Date().toLocaleString()}`);
      showAlert("Moved to main balance!");
      if (btn) {
        btn.disabled = false; btn.textContent = 'Move to Main Balance';
      }
    }

    let lastTgHtml = '';
    function renderTgTasks() {
      const tasks = appConfig.tasks ? Object.entries(appConfig.tasks).map(([k, v]: [string, any]) => ({ key: k, ...v })) : [];
      const container = document.getElementById('dynamic-tasks-container');
      if (container) {
        let html = '';
        tasks.reverse().forEach(task => {
          const completed = userState.completedTasks?.[task.key];
          const timer = userState.tgTaskTimers?.[task.key];
          let btn = '';
          if (completed) {
            btn = `<button class="action-btn" disabled>Claimed</button>`;
          } else if (timer && timer.checkStartTime) {
            const elapsed = Date.now() - timer.checkStartTime;
            const thirtyMins = 30 * 60 * 1000;
            if (elapsed >= thirtyMins) {
              btn = `<button class="action-btn tg-claim-btn" data-task-id="${task.key}">Claim Reward</button>`;
            } else {
              const rem = Math.ceil((thirtyMins - elapsed) / 1000);
              btn = `<button class="action-btn" disabled>Verifying (${formatTime(rem)})</button>`;
            }
          } else if (timer && timer.startTime) {
            btn = `<button class="action-btn tg-check-btn" data-task-id="${task.key}">Check</button>`;
          } else {
            btn = `<button class="action-btn tg-start-btn" data-task-id="${task.key}" data-url="${task.url}">Join Now</button>`;
          }
          html += `<div class="task-container"><img class="task-icon-img" src="${task.icon}"><div class="task-info"><h3>${task.name}</h3><p>+${task.reward} Coins</p></div>${btn}</div>`;
        });
        
        // Only update if content changed to avoid flickering
        if (lastTgHtml !== html) {
          container.innerHTML = html;
          lastTgHtml = html;
          
          document.querySelectorAll('.tg-start-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const id = (btn as HTMLElement).dataset.taskId;
              const url = (btn as HTMLElement).dataset.url;
              if (!id || !url) return;
              tg.openLink(url);
              const startTime = Date.now();
              await db.ref(`users/${tgUser.id}/tgTaskTimers/${id}/startTime`).set(startTime);
              if (!userState.tgTaskTimers) userState.tgTaskTimers = {};
              userState.tgTaskTimers[id] = { startTime };
              
              sendAdminNotification(`🚀 TG Task Started\nUser: ${tgUser.first_name} (${tgUser.id})\nTask: ${appConfig.tasks[id].name}\nStatus: Pending\nTime: ${new Date().toLocaleString()}`);
              renderAll();
            });
          });

          document.querySelectorAll('.tg-check-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const id = (btn as HTMLElement).dataset.taskId;
              if (!id) return;
              const checkStartTime = Date.now();
              await db.ref(`users/${tgUser.id}/tgTaskTimers/${id}/checkStartTime`).set(checkStartTime);
              userState.tgTaskTimers[id].checkStartTime = checkStartTime;
              renderAll();
            });
          });

          document.querySelectorAll('.tg-claim-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const id = (btn as HTMLElement).dataset.taskId;
              if (!id) return;
              const task = appConfig.tasks[id];
              await db.ref(`users/${tgUser.id}/completedTasks/${id}`).set(true);
              await db.ref(`users/${tgUser.id}/earningWallet`).set(firebase.database.ServerValue.increment(task.reward));
              userState.earningWallet = (userState.earningWallet || 0) + task.reward;
              earningWallet = userState.earningWallet;
              if (!userState.completedTasks) userState.completedTasks = {};
              userState.completedTasks[id] = true;
              
              await addHistory('TG Task', task.name, task.reward, 'Completed');
              
              sendAdminNotification(`✅ TG Task Completed\nUser: ${tgUser.first_name} (${tgUser.id})\nTask: ${task.name}\nStatus: Confirmed\nTime: ${new Date().toLocaleString()}`);
              
              renderAll();
              showAlert(`+${task.reward} Coins added to Earning Wallet!`);
            });
          });
        }
      }
    }

    let lastWebHtml = '';
    async function renderWebTasks() {
      const tasksSnap = await db.ref('config/webTasks').once('value');
      const userCompletedSnap = await db.ref(`users/${tgUser.id}/completedWebTasks`).once('value');
      const userCompleted = userCompletedSnap.val() || {};
      
      const tasks: any[] = [];
      tasksSnap.forEach((c: any) => tasks.push({ key: c.key, ...c.val() }));
      const container = document.getElementById('web-tasks-container');
      if (container) {
        let html = '';
        for (let task of tasks) {
          const limitReached = task.limit && (task.completedCount || 0) >= task.limit;
          const done = userCompleted[task.key] === true;
          const timer = userState.webTaskTimers?.[task.key];
          
          let btn = '';
          if (limitReached) {
            btn = `<button class="action-btn" disabled>Limit Reached</button>`;
          } else if (timer && timer.startTime) {
            if (timer.isChecking) {
              btn = `<button class="action-btn" disabled>Checking...</button>`;
            } else {
              btn = `<button class="action-btn web-check-btn" data-key="${task.key}">Check</button>`;
            }
          } else {
            btn = `<button class="action-btn web-start-btn" data-key="${task.key}" data-url="${task.url}">Start Task</button>`;
          }
          
          html += `<div class="task-container"><img class="task-icon-img" src="${task.icon}"><div class="task-info"><h3>${task.name}</h3><p>Reward: ${task.reward} Coins</p><small>${task.limit ? `Global limit: ${task.completedCount || 0}/${task.limit}` : 'Unlimited'}</small></div>${btn}</div>`;
        }
        
        if (lastWebHtml !== html) {
          container.innerHTML = html;
          lastWebHtml = html;
          
          document.querySelectorAll('.web-start-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const key = (btn as HTMLElement).dataset.key;
              const url = (btn as HTMLElement).dataset.url;
              if (!key || !url) return;
              tg.openLink(url);
              const startTime = Date.now();
              await db.ref(`users/${tgUser.id}/webTaskTimers/${key}/startTime`).set(startTime);
              if (!userState.webTaskTimers) userState.webTaskTimers = {};
              userState.webTaskTimers[key] = { startTime };
              
              const taskName = tasks.find(t => t.key === key)?.name || "Web Task";
              sendAdminNotification(`🌐 Web Task Started\nUser: ${tgUser.first_name} (${tgUser.id})\nTask: ${taskName}\nStatus: Pending\nTime: ${new Date().toLocaleString()}`);
              
              renderAll();
            });
          });

          document.querySelectorAll('.web-check-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              const key = (btn as HTMLElement).dataset.key;
              if (!key) return;
              
              // Set checking state
              userState.webTaskTimers[key].isChecking = true;
              renderAll();

              // Wait 2-3 seconds as requested
              setTimeout(async () => {
                const timer = userState.webTaskTimers[key];
                const task = tasks.find(t => t.key === key);
                if (!task || !timer) return;

                const timeSpent = Date.now() - timer.startTime;
                if (timeSpent >= 30000) {
                  await db.ref(`users/${tgUser.id}/completedWebTasks/${key}`).set(true);
                  await db.ref(`users/${tgUser.id}/earningWallet`).set(firebase.database.ServerValue.increment(task.reward));
                  await db.ref(`config/webTasks/${key}/completedCount`).set(firebase.database.ServerValue.increment(1));
                  userState.earningWallet = (userState.earningWallet || 0) + task.reward;
                  earningWallet = userState.earningWallet;
                  
                  await addHistory('Web Task', task.name, task.reward, 'Completed');
                  
                  sendAdminNotification(`✅ Web Task Completed\nUser: ${tgUser.first_name} (${tgUser.id})\nTask: ${task.name}\nStatus: Confirmed\nTime: ${new Date().toLocaleString()}`);
                  
                  showAlert(`+${task.reward} Coins added to Earning Wallet!`);
                  
                  // Clear timer
                  await db.ref(`users/${tgUser.id}/webTaskTimers/${key}`).remove();
                  delete userState.webTaskTimers[key];
                } else {
                  // Clear timer and show message
                  await db.ref(`users/${tgUser.id}/webTaskTimers/${key}`).remove();
                  delete userState.webTaskTimers[key];
                  
                  await addHistory('Web Task', task.name, 0, 'Rejected', "Did not stay 30 seconds");
                  
                  sendAdminNotification(`❌ Web Task Rejected\nUser: ${tgUser.first_name} (${tgUser.id})\nTask: ${task.name}\nStatus: Rejected\nReason: Did not stay 30 seconds\nTime: ${new Date().toLocaleString()}`);
                  
                  showAlert("আপনি ৩০ সেকেন্ড ওয়েট করেন না, তাই আপনি কোনো পয়েন পাবেন না তাই এর পরের বার কাজ করলে ৩০ সেকেন্ড যে ওয়েবসাইট এ নিয়ে জাবে সেখানে ওয়েট করুন");
                }
                renderAll();
              }, 2500);
            });
          });
        }
      }
    }

    async function finishWebTask(taskKey: string, reward: number) {
      const taskRef = db.ref(`config/webTasks/${taskKey}`);
      await taskRef.transaction((t: any) => {
        if (t) {
          if (t.limit && (t.completedCount || 0) >= t.limit) return;
          t.completedCount = (t.completedCount || 0) + 1;
        }
        return t;
      });
      await db.ref(`users/${tgUser.id}/completedWebTasks/${taskKey}`).set(true);
      await db.ref(`users/${tgUser.id}/earningWallet`).set(firebase.database.ServerValue.increment(reward));
      userState.earningWallet = (userState.earningWallet || 0) + reward;
      earningWallet = userState.earningWallet;
      renderAll();
      renderWebTasks();
      showAlert(`+${reward} Coins added to Earning Wallet!`);
    }

    async function startWithdraw(type: string) {
      const minRefs = appConfig.minWithdrawReferrals || 5;
      if ((userState.referrals || 0) < minRefs) {
        showAlert(`Withdrawal failed. You need at least ${minRefs} referrals to withdraw. You currently have ${userState.referrals || 0}.`);
        return;
      }

      const methods = type === 'bdt' ? (appConfig.withdrawBDTMethods || []) : (appConfig.withdrawUSDTMethods || []);
      if (methods.length === 0) { showAlert("No methods available"); return; }
      let methodGrid = `<div class="methods-grid">`;
      methods.forEach((m: any, idx: number) => {
        methodGrid += `<div class="method-card-item" data-method-idx="${idx}"><img src="${m.photo}" onerror="this.src='https://via.placeholder.com/50'"><p>${m.name}</p><p style="font-size:0.6rem; color:var(--primary);">Min: ${m.min} Coins</p></div>`;
      });
      methodGrid += `</div>`;
      const modalHtml = `<div class="modal-header"><h3>Select ${type.toUpperCase()} Method</h3><button class="close-modal">&times;</button></div>${methodGrid}`;
      const container = document.getElementById('withdraw-flow-container');
      if (container) container.innerHTML = modalHtml;
      showModal('withdraw-flow-modal');
      
      document.querySelectorAll('.method-card-item[data-method-idx]').forEach(el => {
        const element = el as HTMLElement;
        element.addEventListener('click', async () => {
          const idx = parseInt(element.dataset.methodIdx || '0');
          const method = methods[idx];
          const rate = type === 'bdt' ? (appConfig.coinToBDT || 0) : (appConfig.coinToUSDT || 0);
          if (!rate) { showAlert("Exchange rate not set by admin."); hideModal('withdraw-flow-modal'); return; }
          const formHtml = `<div class="modal-header"><h3>Withdraw via ${method.name}</h3><button class="close-modal">&times;</button></div>
          <div class="form-group"><label>Account / Wallet ID</label><input id="withdraw-account" placeholder="Enter ${type === 'bdt' ? 'Number' : 'USDT Address'}" style="width:100%; padding:10px; margin:10px 0;"></div>
          <div class="form-group"><label>Coins Amount</label><input type="number" id="withdraw-coins" placeholder="Coins" style="width:100%; padding:10px;"></div>
          <p>You will receive: <strong><span id="live-fiat">0</span> ${type.toUpperCase()}</strong></p>
          <button id="confirm-withdraw" class="action-btn" style="width:100%; margin-top:15px;">Submit Request</button>`;
          if (container) container.innerHTML = formHtml;
          
          const coinsInput = document.getElementById('withdraw-coins') as HTMLInputElement;
          const fiatSpan = document.getElementById('live-fiat');
          const updateFiat = () => {
            let coins = parseFloat(coinsInput.value) || 0;
            if (fiatSpan) fiatSpan.innerText = (coins * rate).toFixed(2);
          };
          coinsInput.addEventListener('input', updateFiat);
          
          document.getElementById('confirm-withdraw')?.addEventListener('click', async () => {
            const account = (document.getElementById('withdraw-account') as HTMLInputElement).value.trim();
            const coinAmount = parseFloat(coinsInput.value);
            if (!account) { showAlert("Enter account details"); return; }
            if (isNaN(coinAmount) || coinAmount < method.min) { showAlert(`Minimum ${method.min} coins required`); return; }
            if (coinAmount > userState.balance) { showAlert("Insufficient balance"); return; }
            const newBalance = userState.balance - coinAmount;
            await db.ref(`users/${tgUser.id}/balance`).set(newBalance);
            userState.balance = newBalance;
            const reqId = db.ref('withdrawals/pending').push().key;
            const request = {
              id: reqId, userId: tgUser.id, userName: `${userState.firstName} ${userState.lastName}`,
              method: method.name, account, amount: coinAmount, status: 'pending',
              timestamp: firebase.database.ServerValue.TIMESTAMP, type
            };
            await db.ref(`withdrawals/pending/${reqId}`).set(request);
            renderAll();
            showAlert("Withdraw request submitted!");
            sendAdminNotification(`💰 Withdrawal Request: ${userState.firstName} requested ${coinAmount} Coins via ${method.name}`);
            hideModal('withdraw-flow-modal');
            hideModal('wallet-modal');
          });
          
          // Re-attach close listener
          document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', () => {
              document.querySelectorAll('.modal-overlay').forEach(m => (m as HTMLElement).style.display = 'none');
            });
          });
        });
      });
    }

    async function showWithdrawHistory() {
      const body = document.getElementById('wallet-modal-body');
      if (!body) return;
      
      body.innerHTML = `<div class="modal-header"><button id="history-back-btn" class="back-btn"><i class="fas fa-arrow-left"></i></button><h3>Withdrawal History</h3><button class="close-modal">&times;</button></div><div class="spinner"></div><p style="text-align:center; margin-top:10px;">Loading history...</p>`;
      
      document.getElementById('history-back-btn')?.addEventListener('click', () => {
        document.getElementById('wallet-icon')?.click();
      });
      
      document.querySelector('#wallet-modal .close-modal')?.addEventListener('click', () => hideModal('wallet-modal'));

      const statuses = ['pending', 'completed', 'rejected'];
      let allReqs: any[] = [];
      try {
        for (let st of statuses) {
          const snap = await db.ref(`withdrawals/${st}`).once('value');
          snap.forEach((r: any) => {
            const val = r.val();
            // Match by userId (number or string)
            if (val.userId == tgUser.id) {
              allReqs.push(val);
            }
          });
        }
      } catch (err) {
        console.error("History fetch error:", err);
      }
      
      allReqs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      
      let html = `<div class="modal-header"><button id="history-back-btn" class="back-btn"><i class="fas fa-arrow-left"></i></button><h3>Withdrawal History</h3><button class="close-modal">&times;</button></div><div class="history-list-container" style="max-height: 400px; overflow-y: auto; padding: 10px;">`;
      if (allReqs.length === 0) {
        html += "<div style='text-align:center; padding:20px;'><p>No withdrawal history found.</p></div>";
      } else {
        allReqs.forEach(req => {
          const date = req.timestamp ? new Date(req.timestamp).toLocaleString() : 'N/A';
          const statusColor = req.status === 'completed' ? '#27ae60' : req.status === 'pending' ? '#f39c12' : '#e74c3c';
          html += `
            <div class="history-item" style="padding: 15px; border-bottom: 1px solid rgba(0,0,0,0.05); background: #f9f9f9; margin-bottom: 10px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
              <div style="flex:1;">
                <div style="font-weight: 600; font-size: 1rem; color: #333;">${req.amount} Coins</div>
                <div style="font-size: 0.8rem; color: #666; margin-top: 2px;">${req.method} - ${req.account}</div>
                <small style="color:gray; font-size: 0.7rem; display: block; margin-top: 4px;">${date}</small>
              </div>
              <div style="color:${statusColor}; font-weight:700; text-transform:uppercase; font-size: 0.75rem; background: ${statusColor}15; padding: 4px 8px; border-radius: 6px;">${req.status}</div>
            </div>`;
        });
      }
      html += `</div>`;
      
      body.innerHTML = html;
      
      document.getElementById('history-back-btn')?.addEventListener('click', () => {
        document.getElementById('wallet-icon')?.click();
      });
      document.querySelector('#wallet-modal .close-modal')?.addEventListener('click', () => hideModal('wallet-modal'));
    }

    async function showPopupMessage() {
      const popupData = await db.ref('config/popupMessage').once('value');
      const data = popupData.val();
      if (data && (data.title || data.description)) {
        let linksHtml = '';
        if (data.links && data.links.length) {
          linksHtml = `<div class="popup-link-group">` + data.links.map((l: any) => `<a href="${l.url}" target="_blank" class="popup-link"><img src="${l.image}" width="50"><span>${l.name}</span></a>`).join('') + `</div>`;
        }
        const popHtml = `<div class="popup-premium"><h2>${data.title || ''}</h2><p>${data.description || ''}</p>${linksHtml}<button class="action-btn close-modal" style="margin-top:20px;">Close</button></div>`;
        const body = document.getElementById('global-popup-body');
        if (body) body.innerHTML = popHtml;
        showModal('global-popup');
        document.querySelector('#global-popup .close-modal')?.addEventListener('click', () => hideModal('global-popup'));
      }
    }

    function renderReferralSection() {
      const link = `https://t.me/${appConfig.botUsername}/app?startapp=${tgUser.id}`;
      const container = document.getElementById('referral-section');
      if (container) {
        container.innerHTML = `
          <div class="referral-card-premium">
            <h3>Refer & Earn</h3>
            <p>Invite your friends and earn <strong>${appConfig.referralBonus || 0} Coins</strong> for each successful referral!</p>
            
            <div class="referral-link-box">
              <input id="ref-link" value="${link}" readonly>
              <button id="copy-ref" class="copy-btn-premium">Copy</button>
            </div>
            
            <div class="referral-stats-mini">
              <span><i class="fas fa-users"></i> ${userState.referrals || 0} Referrals</span>
              <span><i class="fas fa-gift"></i> Bonus: ${appConfig.referralBonus || 0}</span>
            </div>
          </div>`;
          
        document.getElementById('copy-ref')?.addEventListener('click', () => {
          navigator.clipboard.writeText(link);
          showAlert("Referral link copied to clipboard!");
          if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
        });
      }
    }

    async function renderEarningsGraph() {
      const today = new Date(); let dates = [];
      for (let i = 6; i >= 0; i--) { let d = new Date(today); d.setDate(today.getDate() - i); dates.push(d.toISOString().slice(0, 10)); }
      let earnings = [];
      for (let date of dates) {
        let snap = await db.ref(`userEarnings/${tgUser.id}/${date}`).once('value');
        earnings.push(snap.val() || 0);
      }
      const maxE = Math.max(...earnings, 1);
      const chartDiv = document.getElementById('earnings-chart');
      const labelsDiv = document.getElementById('earnings-chart-labels');
      if (chartDiv && labelsDiv) {
        chartDiv.innerHTML = '';
        labelsDiv.innerHTML = '';
        earnings.forEach((val, i) => {
          let height = (val / maxE) * 100;
          chartDiv.innerHTML += `
            <div class="chart-bar" style="height:${height}%;">
              <span class="chart-bar-val">${val}</span>
            </div>`;
          labelsDiv.innerHTML += `<span>${new Date(dates[i]).getDate()}</span>`;
        });
      }
    }

    // Main Init
    async function initApp() {
      tg.ready(); tg.expand();
      document.body.className = `${tg.colorScheme || 'light'}-theme`;
      tgUser = tg.initDataUnsafe.user;
      
      // Mock user for testing outside Telegram
      if (!tgUser?.id) {
        console.warn("No Telegram user found, using mock user for testing.");
        tgUser = { id: 12345678, first_name: "Test", last_name: "User", username: "testuser" };
      }

      try {
        updateLoader(10, "Initializing...");
        const configSnap = await db.ref('config').once('value');
        appConfig = configSnap.val() || {};
        appConfig.adminChatId = '8705098472'; // Force correct admin chat ID
        
        // Ad Config Fallbacks
        if (!appConfig.adZoneId) appConfig.adZoneId = '10806089';
        if (!appConfig.monetagZoneId) appConfig.monetagZoneId = appConfig.adZoneId;
        if (!appConfig.gigaZoneId) appConfig.gigaZoneId = appConfig.gigaPlusZoneId || '9919919';
        if (!appConfig.adValue) appConfig.adValue = 10;
        if (!appConfig.dailyAdLimit) appConfig.dailyAdLimit = 50;
        if (!appConfig.referralBonus) appConfig.referralBonus = 100;
        
        await loadAdAndWait(appConfig.adZoneId);
        
        updateLoader(30, "Checking device...");
        await enforceDeviceLock(tgUser.id);
        updateLoader(40, "Loading user data...");
        await loadUserData();
        updateLoader(60, "Fetching leaderboard...");
        await loadLeaderboard();
        updateLoader(85, "Rendering UI...");
        renderAll();
        renderEarningsGraph();
        updateLoader(100, "Ready!");
        
        setTimeout(() => {
          const loader = document.getElementById('loader-screen');
          const app = document.getElementById('app');
          if (loader) loader.style.display = 'none';
          if (app) app.style.display = 'block';
        }, 500);
        
        await showPopupMessage();
        await sendAdminNotification(`🟢 New user joined: ${userState.firstName} ${userState.lastName} (${tgUser.id})`);
      } catch (err) { 
        console.error(err); 
        updateLoader(100, "Error loading app");
        showAlert("Failed to load app. Check console for details.");
        // Still hide loader so user can see something or at least the app structure
        const loader = document.getElementById('loader-screen');
        const app = document.getElementById('app');
        if (loader) loader.style.display = 'none';
        if (app) app.style.display = 'block';
      }
    }

    // Navigation and Event Listeners
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pageId = (btn as HTMLElement).dataset.page;
        if (!pageId) return;
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const page = document.getElementById(pageId);
        if (page) page.classList.add('active');
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (pageId === 'home-page' || pageId === 'profile-page') renderEarningsGraph();
      });
    });

    document.getElementById('nav-support-btn')?.addEventListener('click', () => {
      tg.openLink(`https://t.me/${appConfig.botUsername || 'earnify'}`);
    });

    document.getElementById('move-to-balance-btn')?.addEventListener('click', moveToBalance);
    
    const refreshInterval = setInterval(() => {
      if (document.getElementById('app')?.style.display === 'block') {
        renderDailyCheckIn();
        renderAdTask();
        renderTgTasks();
        renderWebTasks();
      }
    }, 1000);

    document.getElementById('wallet-icon')?.addEventListener('click', () => {
      const body = document.getElementById('wallet-modal-body');
      if (body) {
        body.innerHTML = `<div style="display: flex; gap: 12px; flex-direction: column;"><div class="methods-grid" style="grid-template-columns: repeat(3,1fr);"><div id="withdraw-bdt-card" class="method-card-item"><i class="fas fa-taka-sign"></i><p>BDT</p></div><div id="withdraw-usdt-card" class="method-card-item"><i class="fas fa-dollar-sign"></i><p>USDT</p></div><div id="history-card" class="method-card-item"><i class="fas fa-history"></i><p>History</p></div></div></div>`;
        showModal('wallet-modal');
        const bdtCard = document.getElementById('withdraw-bdt-card');
        const usdtCard = document.getElementById('withdraw-usdt-card');
        const historyCard = document.getElementById('history-card');
        if (bdtCard) bdtCard.onclick = () => startWithdraw('bdt');
        if (usdtCard) usdtCard.onclick = () => startWithdraw('usdt');
        if (historyCard) historyCard.onclick = showWithdrawHistory;
      }
    });

    document.getElementById('history-icon')?.addEventListener('click', showHistory);

    // Close modals on overlay click
    window.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('modal-overlay')) {
        target.style.display = 'none';
      }
    });

    // Initial close modal listeners
    document.querySelectorAll('.close-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.modal-overlay').forEach(m => (m as HTMLElement).style.display = 'none');
      });
    });

    initApp();
    return () => clearInterval(refreshInterval);
  }, []);

  return (
    <>
      <div id="loader-screen" className="loader-screen">
        <div className="spinner"></div>
        <p id="loading-text" style={{ marginTop: '15px', fontWeight: 600 }}>Loading Earnify...</p>
        <p id="loading-progress">0%</p>
      </div>

      <div id="app" style={{ display: 'none' }}>
        {/* Top Bar */}
        <div className="top-bar">
          <div className="top-left">
            <img id="user-photo" className="user-avatar" src="https://via.placeholder.com/44" alt="user" />
            <div className="user-info">
              <div className="user-name" id="user-name">User</div>
              <div className="main-balance"><span id="main-balance">0</span> Coins</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div className="history-icon" id="history-icon" style={{ cursor: 'pointer', background: 'rgba(255,255,255,0.1)', padding: '8px', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="fas fa-history"></i>
            </div>
            <div className="wallet-icon" id="wallet-icon">
              <i className="fas fa-wallet"></i>
            </div>
          </div>
        </div>

        <main id="main-content">
          {/* HOME PAGE */}
          <div id="home-page" className="page active">
            <div className="earning-wallet-card">
              <h3><i className="fas fa-coins"></i> Earning Wallet</h3>
              <p style={{ fontSize: '1.8rem', fontWeight: 700, color: '#E74C3C' }}><span id="earning-wallet-balance">0</span> Coins</p>
              <small>Minimum 100 Coins to move to main balance.</small>
              <button id="move-to-balance-btn" className="action-btn" style={{ width: '100%', marginTop: '12px' }}>Move to Main Balance</button>
            </div>
            <div id="daily-checkin-container"></div>
            <div id="ad-progress-container"></div>
            <div id="ad-task-container"></div>
          </div>

          {/* TG TASK PAGE (Bonus Tasks) */}
          <div id="tg-tasks-page" className="page">
            <h3 style={{ marginBottom: '12px' }}>🤖 Telegram Bonus Tasks</h3>
            <div id="dynamic-tasks-container"></div>
          </div>

          {/* WEB TASK PAGE */}
          <div id="web-tasks-page" className="page">
            <h3 style={{ marginBottom: '12px' }}>🌐 Web Tasks</h3>
            <div id="web-tasks-container"></div>
          </div>

          {/* PROFILE PAGE (Stats moved from home + referral) */}
          <div id="profile-page" className="page">
            <div className="profile-header-premium card">
              <img id="profile-photo-large" className="profile-avatar-large" src="https://via.placeholder.com/100" alt="user" />
              <h2 id="profile-name-large">User Name</h2>
              <div className="profile-details">
                <p><i className="fas fa-id-badge"></i> ID: <span id="profile-id">0</span></p>
                <p><i className="fas fa-at"></i> Username: @<span id="profile-username">user</span></p>
              </div>
            </div>
            <div className="stats-grid">
              <div className="stat-card"><h4>Today's Ads</h4><p id="daily-ads-watched">0 / 0</p></div>
              <div className="stat-card"><h4>Total Referrals</h4><p id="referral-count">0</p></div>
              <div className="stat-card"><h4>Total Ads Watched</h4><p id="total-ads-watched">0</p></div>
              <div className="stat-card"><h4>Total Earned</h4><p id="total-earned">0</p></div>
            </div>
            <div id="earnings-graph-container" className="card premium-graph" style={{ marginTop: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h3>Last 7 Days Earnings</h3>
                <i className="fas fa-chart-line" style={{ color: '#E74C3C' }}></i>
              </div>
              <div id="earnings-chart" className="chart-container"></div>
              <div id="earnings-chart-labels" className="chart-labels"></div>
            </div>
            <div id="referral-section"></div>
          </div>
        </main>

        <nav className="bottom-nav">
          <button className="nav-btn" data-page="tg-tasks-page"><i className="fab fa-telegram"></i><span>TG Task</span></button>
          <button className="nav-btn" data-page="web-tasks-page"><i className="fas fa-globe"></i><span>Web Task</span></button>
          <button className="nav-btn active home-nav-btn" data-page="home-page">
            <div className="home-icon-wrapper">
              <i className="fas fa-home"></i>
            </div>
            <span>Home</span>
          </button>
          <button className="nav-btn" id="nav-support-btn"><i className="fas fa-headset"></i><span>Support</span></button>
          <button className="nav-btn" data-page="profile-page"><i className="fas fa-user"></i><span>Profile</span></button>
        </nav>
      </div>

      {/* WALLET MODAL */}
      <div id="wallet-modal" className="modal-overlay">
        <div className="modal-container">
          <div className="modal-header"><h3>💰 Wallet</h3><button className="close-modal">&times;</button></div>
          <div id="wallet-modal-body">
            <div style={{ display: 'flex', gap: '12px', flexDirection: 'column' }}>
              <div className="methods-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
                <div className="method-card-item" id="withdraw-bdt-card"><i className="fas fa-taka-sign"></i><p>BDT</p></div>
                <div className="method-card-item" id="withdraw-usdt-card"><i className="fas fa-dollar-sign"></i><p>USDT</p></div>
                <div className="method-card-item" id="history-card"><i className="fas fa-history"></i><p>History</p></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* WITHDRAW FLOW MODAL (dynamic) */}
      <div id="withdraw-flow-modal" className="modal-overlay">
        <div className="modal-container" id="withdraw-flow-container"></div>
      </div>

      {/* POPUP MODAL */}
      <div id="global-popup" className="modal-overlay">
        <div className="modal-container" id="global-popup-body"></div>
      </div>
    </>
  );
}
