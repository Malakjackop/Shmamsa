package com.shmamsa.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shmamsa.model.AppSetting;
import com.shmamsa.repository.AppSettingRepository;
import jakarta.annotation.PostConstruct;
import lombok.Getter;
import org.springframework.stereotype.Service;

import java.time.*;
import java.util.Map;

@Service
public class TimeProvider {

    private static final String TIME_CONFIG_KEY = "time_config";

    private final AppSettingRepository appSettingRepository;
    private final ObjectMapper objectMapper;

    @Getter
    private volatile long timeOffsetMinutes = 0;

    public TimeProvider(AppSettingRepository appSettingRepository, ObjectMapper objectMapper) {
        this.appSettingRepository = appSettingRepository;
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    public void init() {
        loadOffset();
    }

    public LocalDate localDate() {
        return LocalDate.now(clock());
    }

    public LocalTime localTime() {
        return LocalTime.now(clock());
    }

    public LocalDateTime localDateTime() {
        return LocalDateTime.now(clock());
    }

    public Instant instant() {
        return Instant.now(clock());
    }

    public Clock clock() {
        long offsetMillis = timeOffsetMinutes * 60_000;
        return Clock.offset(Clock.systemDefaultZone(), Duration.ofMillis(offsetMillis));
    }

    public synchronized void setTimeOffsetMinutes(long minutes) {
        this.timeOffsetMinutes = minutes;
        saveOffset();
    }

    private void loadOffset() {
        try {
            AppSetting setting = appSettingRepository.findBySettingKey(TIME_CONFIG_KEY).orElse(null);
            if (setting != null) {
                @SuppressWarnings("unchecked")
                Map<String, Object> map = objectMapper.readValue(setting.getSettingValue(), Map.class);
                Object val = map.get("timeOffsetMinutes");
                if (val instanceof Number n) {
                    timeOffsetMinutes = n.longValue();
                }
            }
        } catch (Exception ignored) {
        }
    }

    private void saveOffset() {
        try {
            String json = objectMapper.writeValueAsString(Map.of("timeOffsetMinutes", timeOffsetMinutes));
            AppSetting setting = appSettingRepository.findBySettingKey(TIME_CONFIG_KEY)
                    .orElse(AppSetting.builder().settingKey(TIME_CONFIG_KEY).build());
            setting.setSettingValue(json);
            appSettingRepository.save(setting);
        } catch (JsonProcessingException ignored) {
        }
    }
}
