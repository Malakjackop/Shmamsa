package com.shmamsa.repository;

import com.shmamsa.model.CustomRegistrationField;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CustomRegistrationFieldRepository extends JpaRepository<CustomRegistrationField, Long> {

    List<CustomRegistrationField> findAllByEnabledTrueOrderByDisplayOrderAsc();

    List<CustomRegistrationField> findAllByOrderByDisplayOrderAsc();

    Optional<CustomRegistrationField> findByFieldKey(String fieldKey);

    boolean existsByFieldKey(String fieldKey);

    long countByIsSystemTrue();

    List<CustomRegistrationField> findByIsSystemFalseOrderByDisplayOrderAsc();
}
