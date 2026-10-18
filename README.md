# Bồn Cá / Bathtub Aquarium

Game aquarium kinh tế chạy hoàn toàn trong trình duyệt: 40 loài cá 3D procedural, mua/thả thức ăn, thu tiền, gacha, bán từng cá thể, cọ bồn và nâng bồn/lọc. Không tài khoản, backend, quảng cáo, tiền thật hoặc tài nguyên tải từ bên ngoài.

## Chạy project

Cần **Node >=24.12** và Chrome/Edge mới có **WebGPU**, bật hardware acceleration. Mở qua localhost hoặc HTTPS; game từ chối backend WebGL thay vì âm thầm hạ cấp.

```sh
npm install
npm run dev
# http://127.0.0.1:5173
npm test
npm run build
npm run preview
# http://127.0.0.1:5174
```

`npm test` dùng Node để chạy TypeScript trực tiếp, không cần test transpiler. Dependencies được ghim trong manifest/lockfile.

## Vòng chơi

- Khởi đầu: 300 xu, guppy trưởng thành, goldfish con, hammerhead con, 10 phần thức ăn, sức chứa 5.
- Mua túi → chọn **Thả thức ăn** → bấm mặt nước cho một phần, hoặc giữ để thả đều. Lần lặp đầu sau 300 ms, sau đó mỗi 250 ms; frame chậm không thả bù một loạt. Mỗi phần commit ngay, dùng túi còn hạn cũ nhất, không trừ xu. Nhả/ra khỏi nước/Escape/đổi mode/mở modal/ẩn trang sẽ dừng; quay vào hoặc đóng modal không tự thả tiếp. Hết túi dừng một lần, không tự mua.
- Cá thả tiền chờ thu mỗi 20 giây. **Thu tất cả** mới chuyển tiền vào ví.
- Gacha tạo cá con riêng có ID, kể cả trùng loài. Đàn đầy phải bán cá hoặc nâng bồn trước; không có kho cá ẩn. Xác suất hiển thị đã loại những loài còn khóa.
- **Xem cá** có hover tên/ID, highlight và vòng đánh dấu riêng từng cá thể. Click cá hoặc chọn từ danh sách đàn; click trống hay **Bỏ chọn** để xóa selection. Bán cần xác nhận tên, ID và giá; cá trùng loài không chia sẻ selection/material highlight.
- **Cọ bồn** có vòng bán kính .55 world units và preview đúng các ô chịu tác động. Main resample nét cách tối đa .1 rồi OR vào mask 20 ô cho physics tick; mỗi ô giảm tối đa .15 cùng active timestamp. Nhấc cọ/ngắt nét không nối qua khoảng trống. Preview/flash không thay dirt hoặc thưởng xu. Lọc tự làm sạch và không thu phí vận hành; bồn tối đa 30 cá.
- Túi thức ăn hết hạn sau 2 giờ **chơi thực**, tính riêng từng túi. Cá đói ở mức 0 liên tục 3 phút chơi thực sẽ bỏ đi, không chết.
- Khi hết cá và không còn đủ tiền hoặc cá thưởng sẵn nhận, có thể xác nhận làm lại. Sổ khám phá và ngôn ngữ/âm thanh được giữ; kinh tế và nâng cấp được reset.
- Chơi tiếp bình thường sau khi khám phá đủ 40 loài. Nút Cách chơi giải thích lại vòng chơi; Việt/Anh đổi ngay, âm thanh có thể tắt. Không nhạc nền.

Giao diện arcade dọc dùng chung trên điện thoại và desktop: khung tối đa 480×960 CSS px, HUD/ví vàng, ba chip tài nguyên, canvas ở giữa, dock Xem cá/Thả thức ăn/Cọ bồn và Thu tất cả, năm nút menu dưới cùng. Desktop căn giữa cùng khung, không có sidebar hoặc bảng quản lý dưới bồn. Camera ở `[4,9.2,0]`, Y-up, nhìn dọc chiều dài bồn; fit tám góc theo cấp bồn và kích thước canvas, không orbit/zoom bằng chuột.

Menu mở một native dialog quản lý duy nhất, gồm Cửa hàng/Gacha/Sưu tập/Nâng cấp/Đàn cá; bánh răng mở Cài đặt với ngôn ngữ, âm thanh, nhập/xuất và hướng dẫn. Chỉ body của sheet cuộn; Đóng và tabs luôn ở ngoài vùng cuộn. Escape hoặc bấm backdrop để đóng, focus trở về nút mở. Mở sheet hủy gesture và chặn tương tác bồn nhưng vẫn mô phỏng, cho mua/quay/bán và chọn cá từ đàn. Confirmation vẫn pause như trước. Chọn cá có chủ ý mới mở Đàn cá; cập nhật chỉ số không tự mở lại sheet đã đóng. Safe areas và reduced motion được hỗ trợ, không thêm native packaging/PWA hoặc backend ngoài WebGPU.

## Bản lưu và thời gian vắng mặt

Tự lưu mỗi 5 giây khi chơi, sau giao dịch và khi ẩn/đóng trang. Storage key duy nhất: `bathtub-aquarium.save.v1`. Save JSON phiên bản 1 lưu toàn bộ cá, túi riêng, pellet, tiền chờ và phần tiền lẻ; không lưu đối tượng GPU/audio.

**Xuất bản lưu** tải `bathtub-aquarium-save-YYYY-MM-DD.json`. **Nhập bản lưu** kiểm tra toàn bộ (tối đa 1 MiB) rồi yêu cầu xác nhận thay thế; file lỗi hoặc hủy không đổi lượt hiện tại.

Vắng mặt chỉ tính tối đa 8 giờ: cá lớn và kiếm tiền theo độ no/nước lúc đóng. Không đói thêm, không bẩn thêm, không hết hạn túi/pellet và không mất cá. Tiền vẫn chờ thu. Khi quay lại/import có 60 giây grace chỉ cho bộ đếm bỏ đi, không hồi độ no. Thu nhập được tích phân qua thời điểm trưởng thành, không chạy hàng trăm nghìn bước vật lý.

Popup chào mừng chỉ hiện khi khởi tạo trang từ bản lưu có thời gian vắng mặt. Chuyển tab/ẩn cửa sổ rồi quay lại vẫn reconcile và lưu thu nhập nhưng không mở popup; import cũng chỉ báo đã nhập, không bật chào mừng.

- Save đang lưu hỏng: giữ nguyên dữ liệu, cho tải bản lỗi và xác nhận bắt đầu mới.
- Storage bị chặn/đầy: tiếp tục chơi trong bộ nhớ, có cảnh báo; hãy xuất file trước khi rời trang.
- Tab khác ghi cùng key: tab cũ dừng mô phỏng và mọi đường ghi, cho xuất hoặc tải lại. Không mở hai tab để chơi song song cùng lượt.
- GPU lỗi: dừng chăm cá, cố lưu snapshot cuối và hiện hướng dẫn. Không mở care timer khi WebGPU chưa khởi tạo thành công.

## Cấu trúc

- `src/data/catalog.ts`: 40 ID ổn định, tên/signature Việt/Anh, màu, độ hiếm, cách nhận và gate.
- `src/data/balance.ts`: giá, rate, sức chứa, odds, mốc thưởng và bounds; `fish-anatomy.ts`: profile, envelope tránh biên, scale và tọa độ miệng dùng chung giữa mesh/simulation.
- `src/sim/types.ts`, `engine.ts`: state và engine thuần; thời gian mô phỏng là giây. RNG xorshift32 được lưu và chỉ rút sau khi giao dịch gacha hợp lệ. WeakMap theo run object giữ previous pose, vận tốc, waypoint FNV theo full fish ID và reservation một pursuer/pellet; không serialize motion. Collapse khi pause giữ steering/allowance cọ, replacement mới reset runtime.
- `src/sim/water.ts`: cùng một biên nước bo góc theo scale bồn, signed distance và footprint cọ 20 ô; save V1 cũ vẫn chấp nhận tọa độ chữ nhật.
- `src/input/feed-gesture.ts`: scheduler thuần dùng performance-time milliseconds; giao dịch/count/capture ở scene/controller, không có timer feed chạy ngầm.
- `src/persistence/save.ts`: validation, JSON, browser adapter, offline analytic integration; timestamp là milliseconds.
- `src/render/fish-models.ts`, `fish-geometry.ts`, `fish-textures.ts`: thân sweep bất đối xứng, đĩa ray liền, màng vây cong, atlas màu từng loài và normal/roughness theo loại da. Sampler chụp triangles của thân/đầu trước appendage và cắt miệng; trả normal và tối đa bốn skin weights để chân vây, mắt và mang bám bề mặt. Cache geometry/map/material theo loài, skeleton/highlight riêng mỗi cá; head cố định, pitch/bank quanh miệng thật. Renderer nội suy hai physics pose thay vì snapshot theo render frame.
- `src/ui/`: DOM semantic, i18n, một sheet native với năm tab và Cài đặt riêng, transient dialogs có promise settlement/focus restoration, readout 4 Hz và danh sách 1 Hz. `src/audio.ts`: Web Audio procedural giới hạn voice.
- `src/main.ts`: chủ sở hữu duy nhất của save; nhận action, engine tick 0.05 giây (tối đa 5 bước/frame), đồng bộ render/UI, commit trước reveal và xử lý lifecycle.

Trang `../plush-hammerhead.html` và các project bên cạnh không bị sửa hoặc di chuyển.
## Kiểm chứng giao diện arcade dọc

- Node 24.18.0: `npm test && npm run build` chạy một lần sau tích hợp, **47/47 tests** qua, production build thành công; vẫn có cảnh báo bundle >500 kB. Type-check cuối sau chỉnh focus/import gate cũng qua.
- Chromium headless với adapter WebGPU thật: xem màn chơi 390×844, sheet arcade và khung desktop 1440×1000; kiểm thêm 320×568 và 844×390 không tràn body, dock/menu vẫn tới được. Bồn cấp 0 và 4 thấy đủ hai đầu; nâng cấp 0→1 tăng sức chứa 5→10. Resize và chuyển/đóng sheet giữ đúng một canvas node.
- Fixture seed 123 nhập qua file input và confirmation: mua túi nhỏ trừ 30 xu/thêm 10 phần ngay trong sheet; feedNow đóng sheet trước khi đổi mode. Tap nước trừ một phần, pellet Y=1.27; hai đầu bồn đều nhận tap. Giữ rồi mở sheet bằng keyboard dừng thả; đóng trong lúc vẫn giữ không rearm. Nét cọ giảm các ô dirt cục bộ, không thưởng xu.
- Inspect chọn đúng ID từ canvas, đóng rồi qua tick không tự mở lại. Sort/chọn guppy trùng: hủy Sell giữ hai guppy; xác nhận chỉ bán ID được chọn và cộng 100 xu. Khi control Sell bị xóa, focus về Đóng. Gacha basic trừ 100 xu, thêm đúng một baby, không commit lại sau reveal; mốc fed-10 thêm seahorse và đánh dấu claimed. Collect chuyển đúng pending vào ví và disabled khi hết tiền chờ.
- Đổi EN/mute giữ sau reload. Payload export thật decode V1 và nhập lại giữ fish/food/settings; hủy import giữ bồn hiện tại, xác nhận import hoạt động dưới sheet Cài đặt và không hiện Welcome. Rời trang rồi mở lại sau vắng mặt có Welcome; controlled hidden + visibilitychange không có popup (mô phỏng visibility, không nhận là chuyển tab native).
- Keyboard tới select/summary/buttons; Home/End chuyển tab, Escape/backdrop trả focus về launcher, drag từ nội dung ra ngoài không đóng sheet. Emulate reduced motion bằng media feature: transition 0s, sheet animation none.
- Harness browser-only, không tạo renderer phụ: setBlocked đóng sheet, settle confirm false, không còn dialog che banner; Export/Reload enabled, mutation disabled. Recovery giữ nguyên raw `{broken` trong Blob download, chưa confirm chưa tạo mới; xác nhận phục hồi shell và controls. Harness và các global tạm đã xóa. Không giả lập lỗi GPU phần cứng, không kiểm thiết bị iOS/Android thật, âm thanh bằng tai hoặc FPS.


## Biển xanh sáng

- Phòng xanh lam–ngọc, mặt nước turquoise trong, đường meniscus rõ và thành trong nhuộm xanh ngay dưới đường nước. Mực nước hiện tại `WATER_Y=1.27`, sát mép bồn 1.29; miệng thành trong ở 1.28, mặt nước và vùng thành ngập nối sát nhau. Input thả hạt và validation save dùng cùng hằng số, save cũ có hạt thấp hơn vẫn đọc được. Giữ `FLOOR_Y=-.235`, `SCRUB_Y=-.21`, grid nước 64×32 và tám ripple; dirt vẫn là 20 ô thật của save.
- Mũi theo family/species, cuống đuôi liền thân, chân vây chiếu vào da và blend root→tip theo distal². Mắt định hướng theo normal, mang mảnh bám thân; giữ 40 silhouette, màu nhận diện, ba color passes, rig và mouth-anchor hiện có. Sampler chỉ chạy khi build, không raycast hay tạo geometry/texture mỗi frame.
- Cá mới bơi cao hơn; cá đã lưu không bị đổi pose khi load. Recovery phân biệt vi phạm X/Z với Y, không kéo về tâm khi chỉ sai cao độ. Gia tốc dọc hữu hạn 2.4 chỉ khi ngoài safe Y để hãm đà cũ và hồi cao độ ngay; bình thường vẫn 1.2, không reset vận tốc hay teleport.
- Save V1, catalog, kinh tế và WebGPU-only giữ nguyên; không thêm asset/framework/dependency.
- Khung nhìn fit sát thân bồn thay vì ôm cả sàn và khoảng trống trên vòi, làm bồn chiếm nhiều vùng chơi hơn. Cá mới ở Y .72–.84; cá thường ưu tiên .72–.90, seahorse .50–.80, luôn giao với envelope an toàn dưới mặt nước. Ray vẫn giữ tầng thấp; cá đã lưu chuyển tầng bằng chuyển động bình thường, không sửa tọa độ lúc load.

### Kiểm chứng nước sát mép / popup

`npm test && npm run build`: **47/47 tests** qua và build thành công. Smoke thả hạt/lưu/đọc ở Y=1.27 và đọc save cũ Y=1.15/1.22 đều qua. Xem shader nước/thành trên WebGPU thật, không lỗi browser. Browser headless giữ document luôn visible khi đổi tab, nên smoke dùng trạng thái hidden có kiểm soát và sự kiện visibilitychange: vắng 2.242 giây, active time giữ nguyên, pending tăng 6 xu, không popup. Đóng tab thật rồi mở tab mới: popup chào mừng xuất hiện với thời gian vắng mặt, đã xác nhận trực tiếp.

### Kiểm chứng lượt phóng bồn / nâng nước

`npm test && npm run build`: **47/47 tests** qua, build thành công (còn cảnh báo chunk >500 kB). Smoke public API xác nhận hạt thả ở Y=1.22 lưu/đọc lại được, hạt save cũ Y=1.15 vẫn hợp lệ; cá ở Y=.3 bơi lên .858 sau sáu giây mô phỏng, dịch chuyển hữu hạn và không rút RNG. Xem WebGPU thật ở 1440×1000 và 390×844; mobile không tràn ngang, click feed thật tạo hạt Y=1.22 và trừ đúng một phần; không có lỗi browser. Không đo FPS lại.

### Kiểm chứng lượt biển xanh trước khi nâng nước lên 1.22

- Node **24.18.0**: chạy `npm test && npm run build` đúng một lần sau tích hợp, **47/47 tests** qua; gồm regression seahorse hồi Y nhưng displacement X/Z và heading khớp control trong 1e-8, wallet/RNG không đổi. Build thành công; Vite vẫn cảnh báo chunk lớn hơn 500 kB.
- Probe tạm trong browser thật build đủ **40 loài**, animate phase 0 và π/2, growth 1/cruise: geometry/skinning hữu hạn, weights không âm và tổng 1, ba passes, tối đa **5.438 triangles / 11 bones**. **2.574** root samples cách da .002 ở rest; khoảng cách tối đa tới triangle da sau skinning **.002521**, dưới .003. Mouth-anchor khớp helper với sai số tối đa **1.12e-16**. Probe không tạo renderer phụ và đã được xóa.
- Một tab `http://127.0.0.1:5173/`, `GPUCanvasContext`, adapter WebGPU **Intel gen-12lp**: xem starter ở **1440×1000** và **390×844**, mobile không tràn ngang; toolbar/Collect nằm ngoài canvas, warning amber còn phân biệt. Nhập đúng một save tạm qua file input/xác nhận thật với mười loài trưởng thành (guppy, goldfish, betta, discus, copperband, lionfish, hammerhead, seahorse, manta, oarfish), xem trực tiếp các silhouette và attachment.
- Click chọn manta trong canvas đúng ID; click feed trừ đúng một phần (10→9), pellet ở Y=1.15, ví giữ 300. Một nét cọ ngắn cập nhật đúng bốn ô cục bộ 7/8/12/13; console/error log sau tích hợp và thao tác không có lỗi. File JSON tạm đã được xóa.
- Không đo lại FPS/p95, throttle, video, heavy đàn hoặc toàn bộ economy/lifecycle; các số performance bên dưới chỉ là lịch sử. Người dùng tự đánh giá gameplay/FPS.

## Kiểm chứng đợt trước (trước biển xanh sáng)

Các kết quả lịch sử bên dưới thuộc đợt cải thiện trước, không phải phép đo lại sau thay đổi biển xanh/anatomy. Đợt trước chạy bằng Node **24.18.0**, npm **11.16.0**: `npm test && npm run build` thành công, **46 tests**. Bao phủ kinh tế/offline/save cũ, nước bo góc, mouth transform, previous pose, motion deterministic không rút RNG gacha, 30 cá exact-overlap, pursuit copperband/seahorse/whale-shark/sawfish, hunger/ID priority, reservation và allowance cọ; cadence 300/250 ms, cancel và frame backlog.

Dev `http://127.0.0.1:5173/`, production preview `http://127.0.0.1:5174/`; Edge **155** trên Windows x64, `GPUCanvasContext`, WebGPU **NVIDIA Ampere**, adapter thật không fallback. Không thêm backend, framework hay asset ngoài.

- Nhập/xem đủ ba batch **15/15/10** loài. Proof 40 model: **2.755–5.342 triangles**, **3 color pass**, **7–11 bones**; vertices/normals hữu hạn, index hợp lệ, skin weights tổng 1, skeleton độc lập và geometry dùng chung. Mouth-anchor thật khớp helper tại growth 0/1 × ba heading × hai phase, sai số <1e-5; envelope bao được hai phase kiểm chứng. Copperband giữ headZ .28 nhưng envelope bao cả mõm .49. Highlight clone không đổi material cá cùng loài, clear/dispose giải phóng clone. Cố ý làm Canvas2D thất bại: lỗi có species ID, build tiếp theo thành công, không cache model nửa chừng.
- Kiểm **9 bố cục** cấp 0/2/4 × 1440×1000, 1024×768, 390×844 trên production. Desktop không cuộn trang, Collect/modes trong viewport; mobile không tràn ngang. Nâng bồn tới cấp 4 giữ nguyên fish IDs và khóa nút nâng tiếp. Warning quota nằm trong flow, Collect vẫn thấy được.
- Smoke thật: click trừ 1 phần, hold một giây trừ 4 phần, không trừ xu; reticle 28px, nhiều halo cùng tồn tại. Ra ngoài/quay lại khi giữ, Escape, Help, reveal và reload đều không rearm. Túi cũ được dùng trước; hết thức ăn giữ remaining 0. VI/EN đổi hướng dẫn/count/completion; mute và locale giữ sau reload. Payload export V1 giữ fish/food/settings.
- Đàn 30 cá có video canvas 30 giây, một pellet được ăn đúng một lần. CPU throttle 6× kèm main-thread stall 600 ms không burst feed; các frame chậm chỉ tiến tối đa .25 giây active (5 ticks). Chọn một guppy trùng từ roster, giữ nguyên nút Sell qua cập nhật stats; hủy bán giữ ví/đàn, xác nhận chỉ gỡ đúng ID. Hover/click cá đang bơi và click trống bỏ chọn. Hai nét cọ rời chỉ làm sạch các ô hai đầu, các ô giữa giữ dirt, ví không tăng.
- Nhập save V1 có cá/pellet ngoài góc bo nhưng trong rectangle giữ nguyên pose/credit/TTL lúc commit; regressions kiểm recovery hữu hạn không teleport. Fixture vắng 10 giờ chỉ tính 8 giờ, hunger/dirt/bag/pellet TTL giữ nguyên. Hai tab thật: foreign-save dừng hold/care, visibilitychange/pagehide không ghi đè ví tab mới.
- Lỗi cố ý được tách khỏi normal path: thiếu WebGPU không tạo canvas; quota vẫn cho mua trong bộ nhớ và hiện warning; ném lỗi tại `GPUCanvasContext.getCurrentTexture` khi đang hold gây snapshot-stop, activeSeconds/food đứng yên và export còn dùng được. Đây là kiểm đường renderer-error, không tuyên bố đã gặp lỗi GPU phần cứng tự phát. Console normal path không có lỗi. Chưa đánh giá âm thanh bằng tai.

Đo production sau warmup **5 giây**, **600 requestAnimationFrame intervals/đàn**, viewport **1440×1000**, renderer DPR thực **1.0** (giới hạn cấu hình ≤1.5):

| Đàn | Trung bình ms/frame | p95 ms | FPS trung bình |
|---|---:|---:|---:|
| 30 cá hỗn hợp, gồm 3 guppy riêng | 18.38 | 27.8 | 54.4 |
| 30 manta trưởng thành — model nặng nhất, 5.342 triangles/cá | 14.40 | 22.2 | 69.4 |

Cả hai đạt mục tiêu mean ≥30 FPS, p95 ≤50 ms trên máy này; không phải cam kết cho mọi GPU. Bundle Three/WebGPU khoảng **1.07 MB** trước gzip (**308 KB gzip**); Vite cảnh báo chunk >500 KB, không phải lỗi build. Không WebGL fallback, gallery 40 cá trong một bồn, cheat UI hoặc debug global trong release.

