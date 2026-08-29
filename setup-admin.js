const fs=require('fs'), path=require('path'), crypto=require('crypto'), readline=require('readline');
function ask(q){return new Promise(r=>{const rl=readline.createInterface({input:process.stdin,output:process.stdout});rl.question(q,a=>{rl.close();r(a.trim())})})}
function secret(q){return new Promise(resolve=>{process.stdout.write(q);const stdin=process.stdin;stdin.setRawMode?.(true);stdin.resume();let out='';const on=(c)=>{c=String(c);if(c==='\u0003'){process.stdout.write('\n');process.exit(1)}if(c==='\r'||c==='\n'){stdin.setRawMode?.(false);stdin.removeListener('data',on);process.stdout.write('\n');resolve(out);return}if(c==='\u0008'||c==='\u007f'){out=out.slice(0,-1);return}out+=c;};stdin.on('data',on);})}
(async()=>{
 const databaseUrl=await ask('PostgreSQL DATABASE_URL (leave blank to add it later): ');
 const username=await ask('Admin username: '); if(!username) throw Error('Username is required.');
 const password=await secret('Admin password: '); if(password.length<10) throw Error('Use a password with at least 10 characters.');
 const salt=crypto.randomBytes(16); const hash=crypto.scryptSync(password,salt,64).toString('hex');
 const passwordHash=`scrypt$${salt.toString('hex')}$${hash}`;
 const session=crypto.randomBytes(32).toString('base64url');
 const ingest=crypto.randomBytes(32).toString('base64url');
 const env=`${databaseUrl?`DATABASE_URL=${databaseUrl}\n`:''}ADMIN_USERNAME=${username}\nADMIN_PASSWORD_HASH=${passwordHash}\nSESSION_SECRET=${session}\nONYX_INGEST_TOKEN=${ingest}\n`;
 fs.writeFileSync(path.join(__dirname,'.env'),env,{encoding:'utf8',mode:0o600});
 console.log('\nAdmin credentials saved to .env (ignored by Git).');
 if(!databaseUrl) console.log('Remember to add DATABASE_URL to .env before starting locally, or add it in Render Environment settings.');
 console.log('Start the server and open http://localhost:3000/admin.html');
 console.log('Minecraft plugin ingest token (put this in the server plugin config, NOT GitHub):');
 console.log(ingest);
})().catch(e=>{console.error('\nSetup failed:',e.message);process.exit(1)});
