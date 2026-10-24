// ใช้ใน <head> ของ layout หลัก (ฝั่งเซิร์ฟเวอร์) — key ต้องตรงกับ components/ThemeToggle.tsx
/** สคริปต์ที่รันก่อนหน้าเว็บแสดง เพื่อไม่ให้จอกะพริบสีผิดตอนเปิด */
export const themeBootScript = `try{var t=localStorage.getItem("rc-theme")||"light";if(t==="system")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}`;

