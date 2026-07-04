// app.js
import { login, logout, onAuthReady, isAdmin, currentProfile } from "./auth.js";
import { renderExpensesTab, teardownExpensesTab } from "./expenses.js";
import { renderPlannerTab, teardownPlannerTab } from "./planner.js";
import { renderMediaTab, teardownMediaTab } from "./media.js";
import { renderChatTab, teardownChatTab } from "./chat.js";
import { renderAdminTab } from "./admin.js";

const screenLogin = document.getElementById("screen-login");
const screenApp = document.getElementById("screen-app");
const mainContent = document.getElementById("main-content");
const headerTitle = document.getElementById("header-title");
const userNameEl = document.getElementById("user-name");
const tabAdminBtn = document.getElementById("tab-admin");

const tabConfig = {
  expenses: { title: "Expenses", render: renderExpensesTab, teardown: teardownExpensesTab },
  planner: { title: "Planner", render: renderPlannerTab, teardown: teardownPlannerTab },
  media: { title: "Media", render: renderMediaTab, teardown: teardownMediaTab },
  chat: { title: "Chat", render: renderChatTab, teardown: teardownChatTab },
  admin: { title: "Admin", render: renderAdminTab, teardown: () => {} }
};

let activeTab = "expenses";

function teardownAll() {
  Object.values(tabConfig).forEach((t) => t.teardown && t.teardown());
}

function switchTab(tabName) {
  teardownAll();
  activeTab = tabName;
  headerTitle.textContent = tabConfig[tabName].title;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  tabConfig[tabName].render(mainContent);
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

document.getElementById("btn-login").addEventListener("click", async () => {
  const email = document.getElementById("login-email").value;
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";
  try {
    await login(email, password);
  } catch (err) {
    errorEl.textContent = "Couldn't sign in. Check your email and password, or ask the admin to add you.";
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  teardownAll();
  await logout();
});

onAuthReady((user, profile, errorMessage) => {
  if (!user) {
    screenApp.style.display = "none";
    screenLogin.style.display = "flex";
    if (errorMessage) {
      document.getElementById("login-error").textContent = errorMessage;
    }
    return;
  }

  screenLogin.style.display = "none";
  screenApp.style.display = "block";
  userNameEl.textContent = profile.name;
  tabAdminBtn.style.display = isAdmin() ? "flex" : "none";
  switchTab("expenses");
});
