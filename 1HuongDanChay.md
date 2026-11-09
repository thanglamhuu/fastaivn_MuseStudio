Bước 2: Trên máy khác

Lần đầu thì clone về:

git clone https://github.com/thanglamhuu/fastaivn_MuseStudio.git
cd fastaivn_MuseStudio

Nếu máy đó đã có repo rồi thì chỉ cần kéo bản mới:

git pull origin master

Sau đó cài thư viện Python. Cần chạy lại bước này vì có thư viện mới là cryptography:

python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
pip install -e ./muse2api

Rồi chạy app. run_dev.bat sẽ mở Gateway và giao diện, và tự npm install nếu chưa có:

run_dev.bat

Lưu ý trên máy mới

Tài khoản Muse không đi theo git. Vào tab “Dàn tài khoản Muse” đăng nhập lại hoặc dán cookie.
Muốn dùng nút ghép video thì cần FFmpeg có trong PATH. Kiểm tra bằng:
ffmpeg -version

Nếu chưa có thì cài, ví dụ:

winget install Gyan.FFmpeg
Video tự lưu vào Downloads\MuseStudio\<Tên dự án>\.
Đóng gói thành file .exe thì chạy build_exe.bat như trước.