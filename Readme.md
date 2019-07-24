##Deploy to Firebase
Navigate to the *functions* folder inside of *smart-camera* and run npm install.
```bash
cd functions
npm install
```
Open the *config.json* file in the *functions* directory.
* Server options:
   * ***protocol*** (http or https)
   * ***host*** (server ip address or domain name)
   * ***port*** (server port)
* Auth options: 
   * ***authClientId*** (OAuth2 Client ID identifying Google to your service)
   * ***authClientSecret*** (OAuth2 Client Secret assigned to the Client ID which identifies Google to you)
   * ***authRedirectUrl*** (https://\<project-id\>.firebaseapp.com)
* Project options:
   * ***projectId*** (project-id)

Open the *index.html* file in the *public* directory.
* Specify your OAuth 2.0 client ID
Specify the client ID you created for your action project in the Google Developers Console with the google-signin-client_id meta element.
```
<meta name="google-signin-client_id" content="YOUR_CLIENT_ID.apps.googleusercontent.com">
```
* Specify the project_id in line 30

Now that you have installed the dependencies and configured your project, you are ready to run the app for the first time.
```bash
firebase deploy
```
