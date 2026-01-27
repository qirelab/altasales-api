import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FirebaseService {
  private firebaseApp: admin.app.App;

  constructor(private configService: ConfigService) {
    this.firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT')!)
      ),
    });
  }

  getAuth() {
    return this.firebaseApp.auth();
  }
}
