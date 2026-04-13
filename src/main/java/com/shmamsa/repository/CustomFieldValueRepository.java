package com.shmamsa.repository;

import com.shmamsa.model.CustomFieldValue;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CustomFieldValueRepository extends JpaRepository<CustomFieldValue, Long> {

    List<CustomFieldValue> findAllByUserId(Long userId);

    Optional<CustomFieldValue> findByUserIdAndFieldKey(Long userId, String fieldKey);

    void deleteAllByFieldKey(String fieldKey);
}
