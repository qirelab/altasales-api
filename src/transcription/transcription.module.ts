import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { TranscriptionJob } from './entities/transcription-job.entity';
import { VideoAudioExtractionService } from './services/video-audio-extraction.service';
import { VideoTranscriptionProcessingService } from './services/video-transcription-processing.service';
import { YandexObjectStorageService } from './services/yandex-object-storage.service';
import { YandexSpeechKitTranscriptionService } from './services/yandex-speechkit-transcription.service';
import { TranscriptionController } from './transcription.controller';
import { TranscriptionJobsService } from './transcription-jobs.service';

@Module({
  imports: [TypeOrmModule.forFeature([TranscriptionJob]), AuthModule],
  controllers: [TranscriptionController],
  providers: [
    TranscriptionJobsService,
    YandexSpeechKitTranscriptionService,
    YandexObjectStorageService,
    VideoAudioExtractionService,
    VideoTranscriptionProcessingService,
  ],
})
export class TranscriptionModule {}
