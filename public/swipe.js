// 左スワイプで onComplete を呼ぶ（LINEのアーカイブ操作のイメージ）。
// ケア担当・ラン担当の「スワイプで完了」で共通に使う。

export function enableSwipeComplete(card, fg, onComplete) {
  const THRESHOLD = 90;
  let startX = 0, startY = 0, dx = 0, dragging = false, decided = false, horiz = false;

  const snapBack = () => {
    fg.style.transition = "transform .2s";
    fg.style.transform = "";
    fg.style.animation = "";
    setTimeout(() => { fg.style.transition = ""; }, 200);
  };

  card.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startX = e.clientX; startY = e.clientY;
    dx = 0; dragging = true; decided = false; horiz = false;
    fg.style.transition = "";
    fg.style.animation = "none";
  });
  card.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const mx = e.clientX - startX, my = e.clientY - startY;
    if (!decided) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      decided = true;
      horiz = Math.abs(mx) > Math.abs(my);
      if (horiz) card.setPointerCapture(e.pointerId);
      else { dragging = false; fg.style.animation = ""; return; }
    }
    e.preventDefault();
    dx = Math.min(0, mx);
    fg.style.transform = `translateX(${dx}px)`;
    card.classList.toggle("armed", -dx >= THRESHOLD);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    card.classList.remove("armed");
    if (decided && horiz) {
      // 直後の click（展開トグル）を無効化
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      card.addEventListener("click", swallow, true);
      setTimeout(() => card.removeEventListener("click", swallow, true), 350);
    }
    if (-dx >= THRESHOLD) {
      fg.style.transition = "transform .18s";
      fg.style.transform = "translateX(-110%)";
      setTimeout(onComplete, 160);
    } else {
      snapBack();
    }
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
}
