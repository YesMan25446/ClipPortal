@echo off
echo Starting Clip Portal Server...
echo.
echo Installing dependencies...
call npm install
echo.
echo Starting server...
echo Server will be available at: http://localhost:3000
echo Press Ctrl+C to stop the server
echo.
call npm start
pause
